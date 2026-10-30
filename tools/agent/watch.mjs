#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentError, buildAgentPrompt, canRunNow, claudeEnv, failJob, loadConfig, nextJob, parseArgs, SERVER_ENV_PATH, WATCH_DEFAULTS } from './lib.mjs';

const HELP = `Сторож очереди разбора Instagram. Сам спрашивает сервер и запускает Claude Code с Chrome на каждый заказ.

  node tools/agent/watch.mjs [--once] [--dry] [--interval 120] [--max-per-day 10]

  --once   проверить очередь один раз и выйти
  --dry    не запускать Claude, только показать, что было бы сделано

Предел заказов в сутки и пауза между заказами защищают аккаунт Instagram от ограничений.`;

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here, '..', '..');

function log(text) {
  console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${text}`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function runClaude(prompt, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(
      'claude',
      ['-p', prompt, '--chrome', '--permission-mode', 'acceptEdits', '--allowedTools', 'mcp__claude-in-chrome__*', `Bash(node ${repoDir}/tools/agent/ig-agent.mjs:*)`, 'Write', 'Read'],
      {
        cwd: repoDir,
        env: { ...process.env, ...claudeEnv(process.env, join(repoDir, ...SERVER_ENV_PATH)) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });
}

async function handle(config, job, flags) {
  const workDir = mkdtempSync(join(tmpdir(), 'ig-job-'));
  mkdirSync(join(workDir, 'shots'));
  const prompt = buildAgentPrompt(job, workDir, repoDir);
  if (flags.dry) {
    log(`[dry] заказ ${job.id} (${job.handle}), Claude не запускаю`);
    rmSync(workDir, { recursive: true, force: true });
    return;
  }
  log(`заказ ${job.id}: запускаю Claude для ${job.handle}`);
  const result = await runClaude(prompt, WATCH_DEFAULTS.runTimeoutMs);
  log(result.output.trim().split('\n').slice(-6).join('\n'));
  if (result.code !== 0) {
    log(`Claude завершился с кодом ${result.code}, возвращаю заказ в очередь`);
    await failJob(config, job.id, 'Агент не смог собрать данные профиля', false).catch(() => undefined);
  }
  rmSync(workDir, { recursive: true, force: true });
}

async function main(argv) {
  const { flags } = parseArgs(argv);
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  const config = loadConfig(process.env, join(here, '.env'));
  const limits = {
    ...WATCH_DEFAULTS,
    intervalMs: flags.interval ? Number(flags.interval) * 1000 : WATCH_DEFAULTS.intervalMs,
    maxPerDay: flags['max-per-day'] ? Number(flags['max-per-day']) : WATCH_DEFAULTS.maxPerDay,
  };
  const started = [];
  log(`слежу за очередью ${config.server}, опрос раз в ${limits.intervalMs / 1000} с`);
  for (;;) {
    const gate = canRunNow(started, Date.now(), limits);
    if (!gate.ok) {
      log(`жду: ${gate.reason}`);
      if (flags.once) {
        return 0;
      }
      await sleep(Math.max(gate.waitMs, limits.intervalMs));
      continue;
    }
    try {
      const job = await nextJob(config);
      if (job) {
        started.push(Date.now());
        await handle(config, job, flags);
        if (flags.once) {
          return 0;
        }
        continue;
      }
    } catch (error) {
      log(`сервер недоступен или ответил ошибкой: ${error.message}`);
    }
    if (flags.once) {
      log('очередь пуста');
      return 0;
    }
    await sleep(limits.intervalMs);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof AgentError ? error.message : error);
    process.exit(error instanceof AgentError ? error.code : 1);
  },
);
