import { join } from 'node:path';
import { parseEnvText } from '../agent/lib.mjs';
import {
  CHROME_RELATIVE,
  DETAIL_LIMIT,
  FIX_COMMAND,
  PROBE_PROMPT,
  PROBE_TIMEOUT_MS,
  PROBE_TOOL,
  REPEAT_ALERT_HOURS,
} from './constants.mjs';

export function buildProbeArgs(prompt = PROBE_PROMPT) {
  return [
    '-p',
    prompt,
    '--chrome',
    '--restricted',
    '--model',
    'haiku',
    '--max-turns',
    '3',
    '--tools',
    PROBE_TOOL,
    '--allowedTools',
    PROBE_TOOL,
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--output-format',
    'json',
  ];
}

export function parseProbe({ code, stdout, stderr, timedOut }) {
  if (timedOut) {
    return { ok: false, detail: `probe did not finish in ${PROBE_TIMEOUT_MS / 1000} s` };
  }
  let result;
  try {
    result = JSON.parse(stdout).result;
  } catch {
    const detail = `claude exited with code ${code}: ${`${stdout} ${stderr}`.trim()}`.replace(/\s+/g, ' ');
    return { ok: false, detail: detail.slice(0, DETAIL_LIMIT) };
  }
  if (typeof result === 'string' && /^\s*OK\b/.test(result)) {
    return { ok: true, detail: 'extension answered' };
  }
  const detail = String(result ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DETAIL_LIMIT);
  return { ok: false, detail: detail || 'claude gave no answer' };
}

export function parseRegValue(output) {
  const match = /REG_SZ\s+(.+?)\s*$/m.exec(output ?? '');
  return match ? match[1].trim() : undefined;
}

export function countProcesses(tasklistCsv, name) {
  const prefix = `"${name.toLowerCase()}"`;
  return tasklistCsv.split(/\r?\n/).filter((line) => line.toLowerCase().startsWith(prefix)).length;
}

function csvFields(line) {
  return Array.from(line.matchAll(/"((?:[^"]|"")*)"/g), (match) => match[1].replace(/""/g, '"'));
}

export function parseTaskCsv(csv) {
  const rows = csv
    .split(/\r?\n/)
    .filter((line) => line.startsWith('"'))
    .map(csvFields);
  if (rows.length < 2) {
    return undefined;
  }
  const [, , nextRun, status, , lastRun, lastResult] = rows[1];
  return { status, nextRun, lastRun, lastResult };
}

export function chromeCandidates(env) {
  return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
    .filter(Boolean)
    .map((base) => join(base, ...CHROME_RELATIVE));
}

export function findOnPath(name, pathValue, exists, pathExt = '.EXE;.CMD') {
  const separator = process.platform === 'win32' ? ';' : ':';
  const extensions = ['', ...pathExt.split(';').filter(Boolean).map((ext) => ext.toLowerCase())];
  for (const dir of (pathValue ?? '').split(separator).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function staticProblems(facts) {
  const problems = [];
  if (!facts.claude) {
    problems.push('claude.exe not found (install Claude Code)');
  }
  if (!facts.manifest) {
    problems.push('native host is not registered in Chrome (run claude, then /chrome, and pick install)');
  } else if (!facts.manifestExists) {
    problems.push(`native host manifest is missing: ${facts.manifest}`);
  } else if (!facts.hostExists) {
    problems.push(`native host launcher is missing: ${facts.hostPath}`);
  }
  if (!facts.extensionExists) {
    problems.push(`Claude in Chrome extension is not installed in profile ${facts.profile}`);
  }
  if (!facts.chrome) {
    problems.push('chrome.exe not found');
  }
  return problems;
}

export function emptyState() {
  return { status: 'unknown', since: null, lastCheck: null, lastAlert: null, detail: '' };
}

export function hoursBetween(from, to) {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3600000;
}

export function alertKind(state, verdict, nowIso, repeatHours = REPEAT_ALERT_HOURS) {
  if (verdict.ok) {
    return state.status === 'broken' ? 'recovered' : undefined;
  }
  const changed = state.status !== 'broken';
  const silent = !state.lastAlert;
  const repeat = !silent && hoursBetween(state.lastAlert, nowIso) >= repeatHours;
  return changed || silent || repeat ? 'broken' : undefined;
}

export function applyVerdict(state, verdict, nowIso, { alerted = false, recovered = false } = {}) {
  const status = verdict.ok ? 'ok' : 'broken';
  let lastAlert = state.lastAlert;
  if (alerted) {
    lastAlert = nowIso;
  } else if (recovered) {
    lastAlert = null;
  }
  return {
    status,
    since: state.status === status ? state.since : nowIso,
    lastCheck: nowIso,
    lastAlert,
    detail: verdict.detail,
  };
}

export function brokenMessage(detail) {
  return `Связка Chrome и Claude Code сломана: ${detail}. Команды /content-plan и /content-review без неё не увидят страницы. Починка: ${FIX_COMMAND} (перезапустит Chrome). Если не помогло: в Claude Code выполнить /chrome и переустановить расширение Claude in Chrome.`;
}

export const RECOVERED_MESSAGE = 'Связка Chrome и Claude Code снова работает.';

export function telegramConfig(envText) {
  const values = parseEnvText(envText);
  const token = values.TELEGRAM_BOT_TOKEN;
  const chat = values.TELEGRAM_CHAT_ID;
  return token && chat ? { token, chat } : undefined;
}

export function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function localIso(date = new Date()) {
  return stamp(date).replace(' ', 'T');
}
