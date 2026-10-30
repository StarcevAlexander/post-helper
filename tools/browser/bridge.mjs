#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { claudeEnv, parseArgs } from '../agent/lib.mjs';
import { claudeBinary } from '../intake-agent/lib.mjs';
import {
  ACTIONS,
  CHECK_EVERY_MINUTES,
  CHROME_APP_PATH_KEY,
  CHROME_CLOSE_MS,
  CHROME_PROCESS,
  CHROME_START_MS,
  DEFAULT_PROFILE,
  ENV_PATH,
  EXTENSION_ID,
  FIX_COMMAND,
  HIDDEN_TASK_PATH,
  HOST_KEY,
  LOCK_PROCESS,
  LOG_FILE,
  NETWORK_ERROR_CODES,
  PROBE_TIMEOUT_MS,
  SCRIPT_PATH,
  STATE_FILE,
  TASK_NAME,
  TELEGRAM_API,
  TELEGRAM_TIMEOUT_MS,
  TUNNEL_ADAPTER_PREFIX,
  TUNNEL_TIMEOUT_MS,
  TUNNEL_URL,
} from './constants.mjs';
import {
  RECOVERED_MESSAGE,
  alertKind,
  applyVerdict,
  brokenMessage,
  buildProbeArgs,
  chromeCandidates,
  countProcesses,
  emptyState,
  findOnPath,
  localIso,
  parseProbe,
  parseRegValue,
  parseTaskCsv,
  stamp,
  staticProblems,
  telegramConfig,
} from './lib.mjs';

const HELP = `Лекарь связки Claude Code с расширением Claude in Chrome.

  node tools/browser/bridge.mjs check|fix|run|install|uninstall|status [--profile Default]

  check      проверить связку пробным запросом и сказать, что сломано
  fix        то же и починить: запустить или перезапустить Chrome
  run        постоянный процесс для задачи планировщика: проверяет раз в час, пишет в лог и Telegram, окна не держит
  install    поставить задачу ${TASK_NAME}: проверка раз в ${CHECK_EVERY_MINUTES} мин без окна
  uninstall  снять задачу
  status     состояние задачи, связки и последние строки лога`;

const here = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(here, '..', '..');
const logFile = join(here, LOG_FILE);
const stateFile = join(here, STATE_FILE);

const { positional, flags } = parseArgs(process.argv.slice(2));
const action = positional[0] ?? 'check';
const profile = typeof flags.profile === 'string' ? flags.profile : DEFAULT_PROFILE;
const quiet = action === 'run';

if (flags.help || !ACTIONS.includes(action)) {
  console.log(HELP);
  process.exit(ACTIONS.includes(action) ? 0 : 2);
}

setDefaultResultOrder('ipv4first');
setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);

function writeLog(text) {
  const line = `${stamp()} ${text}\n`;
  if (quiet) {
    process.stdout.write(line);
    return;
  }
  try {
    appendFileSync(logFile, line, 'utf8');
  } catch {
    process.stdout.write(`(log busy) ${line}`);
  }
}

function say(text) {
  if (!quiet) {
    console.log(text);
  }
  writeLog(text);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function httpsRequest(url, { method, headers = {}, body, timeoutMs }) {
  return new Promise((done, fail) => {
    const req = request(url, { method, headers }, (response) => {
      response.resume();
      response.on('end', () => done({ status: response.statusCode ?? 0 }));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(`no answer in ${timeoutMs / 1000} s`), { code: 'ETIMEDOUT' })), timeoutMs);
    req.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

function command(file, args) {
  return new Promise((done) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      done({ code: error ? (error.code ?? 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

async function regValue(key) {
  const result = await command('reg', ['query', key, '/ve']);
  return parseRegValue(result.stdout);
}

async function processCount(name) {
  const result = await command('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH']);
  return countProcesses(result.stdout, name);
}

function claudePath() {
  const binary = claudeBinary();
  if (existsSync(binary)) {
    return binary;
  }
  return findOnPath(binary, process.env.PATH, existsSync, process.env.PATHEXT);
}

async function chromePath() {
  const local = chromeCandidates(process.env).find((candidate) => existsSync(candidate));
  if (local) {
    return local;
  }
  const registered = await regValue(CHROME_APP_PATH_KEY);
  return registered && existsSync(registered) ? registered : undefined;
}

async function collectFacts() {
  const manifest = await regValue(HOST_KEY);
  const manifestExists = Boolean(manifest) && existsSync(manifest);
  let hostPath;
  if (manifestExists) {
    try {
      hostPath = JSON.parse(readFileSync(manifest, 'utf8')).path;
    } catch {
      hostPath = undefined;
    }
  }
  return {
    claude: claudePath(),
    manifest,
    manifestExists,
    hostPath,
    hostExists: Boolean(hostPath) && existsSync(hostPath),
    extensionExists: existsSync(join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data', profile, 'Extensions', EXTENSION_ID)),
    chrome: await chromePath(),
    profile,
  };
}

function probe(claude) {
  return new Promise((done) => {
    const env = { ...process.env, ...claudeEnv(process.env, join(repoDir, ...ENV_PATH)) };
    delete env.CLAUDECODE;
    const child = spawn(claude, buildProbeArgs(), { cwd: tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROBE_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      done(parseProbe({ code: 1, stdout, stderr: `${stderr} ${error.message}` }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(parseProbe({ code, stdout, stderr, timedOut }));
    });
  });
}

async function verdictOf() {
  const facts = await collectFacts();
  const problems = staticProblems(facts);
  if (problems.length > 0) {
    return { ok: false, detail: problems.join('; '), static: true };
  }
  if ((await processCount(CHROME_PROCESS)) === 0) {
    return { ok: false, detail: 'Chrome is not running', chromeDown: true, chrome: facts.chrome };
  }
  return { ...(await probe(facts.claude)), chrome: facts.chrome };
}

async function startChrome(chrome, reason) {
  spawn(chrome, [`--profile-directory=${profile}`, '--restore-last-session'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  say(`Chrome started (${reason}), waiting ${CHROME_START_MS / 1000} s`);
  await sleep(CHROME_START_MS);
}

async function restartChrome(chrome, reason) {
  say(`restarting Chrome (${reason})`);
  await command('taskkill', ['/IM', CHROME_PROCESS]);
  const deadline = Date.now() + CHROME_CLOSE_MS;
  while (Date.now() < deadline && (await processCount(CHROME_PROCESS)) > 0) {
    await sleep(1000);
  }
  if ((await processCount(CHROME_PROCESS)) > 0) {
    await command('taskkill', ['/F', '/T', '/IM', CHROME_PROCESS]);
    await sleep(2000);
  }
  await startChrome(chrome, 'after restart');
}

async function repair(verdict, allowRestart) {
  if (verdict.static) {
    return verdict;
  }
  if (verdict.chromeDown) {
    await startChrome(verdict.chrome, 'not running');
    verdict = await verdictOf();
    if (verdict.ok) {
      return verdict;
    }
  }
  if (!allowRestart) {
    return verdict;
  }
  await restartChrome(verdict.chrome, verdict.detail);
  return verdictOf();
}

async function tunnelUp() {
  const adapters = Object.keys(networkInterfaces());
  if (!adapters.some((name) => name.toLowerCase().startsWith(TUNNEL_ADAPTER_PREFIX))) {
    return false;
  }
  try {
    await httpsRequest(TUNNEL_URL, { method: 'HEAD', timeoutMs: TUNNEL_TIMEOUT_MS });
    return true;
  } catch (error) {
    return !NETWORK_ERROR_CODES.includes(error.code);
  }
}

function readState() {
  if (existsSync(stateFile)) {
    try {
      return { ...emptyState(), ...JSON.parse(readFileSync(stateFile, 'utf8')) };
    } catch {
      return emptyState();
    }
  }
  return emptyState();
}

function saveState(state) {
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function sendTelegram(text) {
  const envFile = join(repoDir, ...ENV_PATH);
  if (!existsSync(envFile)) {
    writeLog('telegram: server/.env not found, message not sent');
    return false;
  }
  const config = telegramConfig(readFileSync(envFile, 'utf8'));
  if (!config) {
    writeLog('telegram: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty, message not sent');
    return false;
  }
  try {
    const { status } = await httpsRequest(`${TELEGRAM_API}/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chat, text }),
      timeoutMs: TELEGRAM_TIMEOUT_MS,
    });
    if (status !== 200) {
      writeLog(`telegram: failed: HTTP ${status}`);
      return false;
    }
    writeLog('telegram: sent');
    return true;
  } catch (error) {
    writeLog(`telegram: failed: ${error.code ?? error.message}`);
    return false;
  }
}

async function updateState(verdict, alert) {
  const state = readState();
  const now = localIso();
  const kind = alert ? alertKind(state, verdict, now) : undefined;
  let alerted = false;
  let recovered = false;
  if (kind === 'broken') {
    alerted = await sendTelegram(brokenMessage(verdict.detail));
  } else if (kind === 'recovered') {
    await sendTelegram(RECOVERED_MESSAGE);
    recovered = true;
  }
  saveState(applyVerdict(state, verdict, now, { alerted, recovered }));
}

function showVerdict(verdict) {
  say(verdict.ok ? 'bridge OK: Claude Code reaches the Chrome extension' : `bridge BROKEN: ${verdict.detail}`);
}

async function check() {
  const verdict = await verdictOf();
  showVerdict(verdict);
  await updateState(verdict, false);
  if (!verdict.ok) {
    console.log(`fix: ${FIX_COMMAND}`);
    process.exitCode = 1;
  }
}

async function fix() {
  let verdict = await verdictOf();
  showVerdict(verdict);
  if (!verdict.ok) {
    verdict = await repair(verdict, true);
    showVerdict(verdict);
  }
  await updateState(verdict, true);
  if (!verdict.ok) {
    process.exitCode = 1;
  }
}

async function runOnce() {
  if (!(await tunnelUp())) {
    writeLog('tunnel is down, check skipped (the Happ start script handles the tunnel)');
    return;
  }
  let verdict = await verdictOf();
  if (!verdict.ok) {
    const locked = (await processCount(LOCK_PROCESS)) > 0;
    verdict = await repair(verdict, locked);
    if (!verdict.ok && !verdict.static && !locked) {
      writeLog('screen is not locked, the owner may be working: Chrome left untouched');
    }
  }
  showVerdict(verdict);
  await updateState(verdict, true);
}

async function run() {
  for (;;) {
    try {
      await runOnce();
    } catch (error) {
      writeLog(`bridge check failed: ${error.message}`);
    }
    await sleep(CHECK_EVERY_MINUTES * 60 * 1000);
  }
}

async function install() {
  const result = await command('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(repoDir, ...HIDDEN_TASK_PATH),
    'install',
    '-TaskName',
    TASK_NAME,
    '-Script',
    join(repoDir, ...SCRIPT_PATH),
    '-Arguments',
    'run',
    '-Log',
    logFile,
    '-Repo',
    repoDir,
    '-KeepAliveMinutes',
    String(CHECK_EVERY_MINUTES),
  ]);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) {
    process.exitCode = result.code;
  }
}

async function uninstall() {
  const result = await command('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
  console.log(result.code === 0 ? `Task ${TASK_NAME} removed` : `Task ${TASK_NAME} was not installed`);
}

async function status() {
  const result = await command('schtasks', ['/Query', '/TN', TASK_NAME, '/V', '/FO', 'CSV']);
  const task = result.code === 0 ? parseTaskCsv(result.stdout) : undefined;
  if (task) {
    console.log(`Task ${TASK_NAME}: ${task.status}, last run ${task.lastRun}, last result ${task.lastResult}, next run ${task.nextRun}`);
  } else {
    console.log(`Task ${TASK_NAME} is not installed`);
  }
  const state = readState();
  console.log(`bridge: ${state.status} since ${state.since}, last check ${state.lastCheck} ${state.detail}`);
  if (existsSync(logFile)) {
    console.log(readFileSync(logFile, 'utf8').trim().split(/\r?\n/).slice(-5).join('\n'));
  }
}

const handlers = { check, fix, run, install, uninstall, status };
handlers[action]().catch((error) => {
  writeLog(`bridge failed: ${error.message}`);
  console.error(error.message);
  process.exitCode = 1;
});
