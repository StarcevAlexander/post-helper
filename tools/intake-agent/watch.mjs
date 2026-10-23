#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../agent/lib.mjs';
import { AGENT_DEFAULTS, PLAN_FILE, REPORTS_DIR, REPORT_FILE, STATE_FILE } from './constants.mjs';
import {
  AgentError,
  buildClaudeArgs,
  buildFixPrompt,
  buildPrompt,
  canRunNow,
  claudeBinary,
  formatReport,
  listNewIntakes,
  loadOwnerConfig,
  loadState,
  localDate,
  pickIntake,
  readAgentFile,
  readGuide,
  recordRun,
  runTimes,
  saveState,
  tomorrowOf,
  uploadPlan,
  validatePlan,
} from './lib.mjs';

const HELP = `Сторож заявок на контент-план. Сам берёт новую заявку мастера, запускает запертого агента Claude,
проверяет и заливает план мастеру, пишет отчёт в tools/intake-agent/reports.

  node tools/intake-agent/watch.mjs [--once] [--dry] [--interval 60] [--max-per-day 6]

  --once   проверить заявки один раз и выйти
  --dry    показать, какую заявку взял бы, но агента не запускать

Агент работает без команд и без вашего браузера: только чтение открытых страниц и запись двух файлов.
Откат залитого плана: node tools/owner/owner.mjs restore <id мастера> <версия>.`;

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here, '..', '..');
const stateFile = join(here, STATE_FILE);

function log(text) {
  console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${text}`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function runClaude(prompt, workDir, limits) {
  return new Promise((done) => {
    const child = spawn(claudeBinary(), buildClaudeArgs(workDir, limits), {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ code: 1, output: `${output}\n${error.message}` });
    });
    const timer = setTimeout(() => child.kill(), limits.runTimeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
    child.stdin.end(prompt);
  });
}

function costOf(output) {
  try {
    const cost = JSON.parse(output).total_cost_usd;
    return typeof cost === 'number' ? cost : undefined;
  } catch {
    return undefined;
  }
}

function readPlan(workDir) {
  const text = readAgentFile(workDir, PLAN_FILE);
  if (text === undefined) {
    return { problems: [`агент не создал ${PLAN_FILE}`] };
  }
  try {
    return { plan: JSON.parse(text), problems: [] };
  } catch (error) {
    return { problems: [`${PLAN_FILE} не разобрать как JSON: ${error.message}`] };
  }
}

async function produce(config, intake, workDir, limits, now) {
  const tomorrow = tomorrowOf(now);
  let cost = 0;
  const first = await runClaude(buildPrompt(intake, { guide: readGuide(repoDir), tomorrow }), workDir, limits);
  cost += costOf(first.output) ?? 0;
  if (first.code !== 0) {
    log(`Claude завершился с кодом ${first.code}: ${first.output.trim().split('\n').slice(-3).join(' | ')}`);
  }
  let attempt = readPlan(workDir);
  let problems = attempt.problems.length > 0 ? attempt.problems : validatePlan(attempt.plan, now);

  for (let retry = 0; retry <= limits.retries; retry += 1) {
    if (problems.length === 0) {
      try {
        const result = await uploadPlan(config, intake.masterId, attempt.plan);
        return { result, cost };
      } catch (error) {
        if (!(error instanceof AgentError) || error.code !== 6) {
          throw error;
        }
        problems = [`сервер отклонил план: ${error.message}`];
      }
    }
    if (retry === limits.retries) {
      break;
    }
    log(`план не принят, прошу исправить: ${problems.join('; ')}`);
    const fix = await runClaude(buildFixPrompt(problems, { tomorrow }), workDir, limits);
    cost += costOf(fix.output) ?? 0;
    attempt = readPlan(workDir);
    problems = attempt.problems.length > 0 ? attempt.problems : validatePlan(attempt.plan, now);
  }
  throw new AgentError(`план не прошёл проверку: ${problems.join('; ')}`, 6);
}

async function handle(config, intake, flags, limits, state) {
  const now = new Date();
  if (flags.dry) {
    log(`[dry] взял бы заявку ${intake.id} (${intake.masterName}), агента не запускаю`);
    return;
  }
  const workDir = mkdtempSync(join(tmpdir(), 'intake-job-'));
  log(`заявка ${intake.id} (${intake.masterName}): запускаю агента, рабочая папка ${workDir}`);
  try {
    const { result, cost } = await produce(config, intake, workDir, limits, now);
    recordRun(state, intake, 'uploaded', now.getTime(), { version: result.version, items: result.items });
    saveState(stateFile, state);
    const reportsDir = join(here, REPORTS_DIR);
    mkdirSync(reportsDir, { recursive: true });
    const name = `${localDate(now)}-${intake.masterId}-${intake.id}.md`;
    writeFileSync(
      join(reportsDir, name),
      formatReport({
        intake,
        result,
        agentReport: readAgentFile(workDir, REPORT_FILE),
        costUsd: cost > 0 ? cost : undefined,
        now,
      }),
    );
    log(`готово: версия ${result.version}, публикаций ${result.items}. Отчёт: tools/intake-agent/reports/${name}`);
  } catch (error) {
    recordRun(state, intake, 'failed', now.getTime(), { error: String(error.message).slice(0, 300) });
    saveState(stateFile, state);
    log(`не вышло: ${error.message}. Эту версию заявки больше не трогаю, решите вручную: /content-plan`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const { flags } = parseArgs(argv);
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  const config = loadOwnerConfig(process.env, join(repoDir, 'tools', 'owner', '.env'));
  const limits = {
    ...AGENT_DEFAULTS,
    intervalMs: flags.interval ? Number(flags.interval) * 1000 : AGENT_DEFAULTS.intervalMs,
    maxPerDay: flags['max-per-day'] ? Number(flags['max-per-day']) : AGENT_DEFAULTS.maxPerDay,
  };
  const state = loadState(stateFile);
  log(`слежу за заявками ${config.server}, опрос раз в ${limits.intervalMs / 1000} с`);
  for (;;) {
    const gate = canRunNow(runTimes(state), Date.now(), limits);
    try {
      const intakes = await listNewIntakes(config);
      const intake = pickIntake(intakes, state, Date.now(), limits);
      if (intake && gate.ok) {
        await handle(config, intake, flags, limits, state);
      } else if (intake) {
        log(`жду: ${gate.reason}`);
      }
    } catch (error) {
      if (error instanceof AgentError && error.code === 5) {
        throw error;
      }
      log(`сервер недоступен или ответил ошибкой: ${error.message}`);
    }
    if (flags.once) {
      return 0;
    }
    await sleep(limits.intervalMs);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof AgentError ? error.message : error);
    process.exitCode = error instanceof AgentError ? error.code : 1;
  },
);
