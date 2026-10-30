import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { SERVER_ENV_PATH, ZAI_ANTHROPIC_BASE_URL, ZAI_MODEL_ENV } from './constants.mjs';

export { SERVER_ENV_PATH };

export const MAX_IMAGES = 12;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export class AgentError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith('--')) {
      const name = item.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = true;
      } else {
        flags[name] = next;
        index += 1;
      }
    } else {
      positional.push(item);
    }
  }
  return { positional, flags };
}

export function parseEnvText(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    values[key] = value;
  }
  return values;
}

export const DEFAULT_SERVER = 'http://127.0.0.1:8081';

export function loadConfig(env, envFile) {
  const fromFile = envFile && existsSync(envFile) ? parseEnvText(readFileSync(envFile, 'utf8')) : {};
  const server = (env.AGENT_SERVER ?? fromFile.AGENT_SERVER ?? DEFAULT_SERVER).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) {
    throw new AgentError('AGENT_SERVER должен начинаться с http:// или https://', 2);
  }
  return { server };
}

export function claudeEnv(env, envFile) {
  const fromFile = envFile && existsSync(envFile) ? parseEnvText(readFileSync(envFile, 'utf8')) : {};
  const token = String(env.ZAI_AUTH_TOKEN ?? fromFile.ZAI_AUTH_TOKEN ?? '').trim();
  if (!token) {
    return {};
  }
  return {
    ANTHROPIC_BASE_URL: fromFile.ANTHROPIC_BASE_URL || ZAI_ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: token,
    ...ZAI_MODEL_ENV,
  };
}

const NUMBER_FIELDS = ['followers', 'following', 'postsCount'];
const POST_NUMBER_FIELDS = ['likes', 'comments', 'views'];

function isCount(value) {
  return value === null || value === undefined || (Number.isInteger(value) && value >= 0);
}

export function validateCollected(data) {
  const problems = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return ['данные должны быть объектом'];
  }
  if (typeof data.handle !== 'string' || !data.handle.trim()) {
    problems.push('нет поля handle (ник профиля)');
  }
  for (const field of ['name', 'bio', 'externalUrl', 'category', 'notes', 'location']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      problems.push(`поле ${field} должно быть строкой`);
    }
  }
  for (const field of NUMBER_FIELDS) {
    if (!isCount(data[field])) {
      problems.push(`поле ${field} должно быть целым числом не меньше нуля или null`);
    }
  }
  if (data.geoTags !== undefined) {
    if (!Array.isArray(data.geoTags)) {
      problems.push('поле geoTags должно быть списком');
    } else {
      data.geoTags.forEach((tag, index) => {
        if (typeof tag !== 'object' || tag === null || typeof tag.name !== 'string' || !tag.name.trim()) {
          problems.push(`геометка ${index + 1}: нужно поле name со строкой`);
        } else if (!isCount(tag.count)) {
          problems.push(`геометка ${index + 1}: поле count должно быть целым числом не меньше нуля или null`);
        }
      });
    }
  }
  if (data.highlights !== undefined && !(Array.isArray(data.highlights) && data.highlights.every((item) => typeof item === 'string'))) {
    problems.push('поле highlights должно быть списком строк');
  }
  if (data.posts !== undefined) {
    if (!Array.isArray(data.posts)) {
      problems.push('поле posts должно быть списком');
    } else {
      data.posts.forEach((post, index) => {
        if (typeof post !== 'object' || post === null) {
          problems.push(`публикация ${index + 1} должна быть объектом`);
          return;
        }
        for (const field of ['type', 'caption', 'date', 'url']) {
          if (post[field] !== undefined && typeof post[field] !== 'string') {
            problems.push(`публикация ${index + 1}: поле ${field} должно быть строкой`);
          }
        }
        for (const field of POST_NUMBER_FIELDS) {
          if (!isCount(post[field])) {
            problems.push(`публикация ${index + 1}: поле ${field} должно быть целым числом не меньше нуля или null`);
          }
        }
      });
    }
  }
  return problems;
}

export function listImages(paths) {
  const files = [];
  for (const path of paths) {
    if (!existsSync(path)) {
      throw new AgentError(`Нет такого файла или папки: ${path}`, 2);
    }
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (IMAGE_TYPES[extname(name).toLowerCase()]) {
          files.push(join(path, name));
        }
      }
    } else if (IMAGE_TYPES[extname(path).toLowerCase()]) {
      files.push(path);
    } else {
      throw new AgentError(`Не картинка: ${path}`, 2);
    }
  }
  if (files.length === 0) {
    throw new AgentError('Не найдено ни одной картинки (png, jpg, webp, gif)', 2);
  }
  if (files.length > MAX_IMAGES) {
    throw new AgentError(`Картинок ${files.length}, а можно не больше ${MAX_IMAGES}`, 2);
  }
  for (const file of files) {
    if (statSync(file).size > MAX_IMAGE_BYTES) {
      throw new AgentError(`Картинка больше 6 МБ: ${file}`, 2);
    }
  }
  return files;
}

export function buildForm(data, files) {
  const form = new FormData();
  form.append('data', JSON.stringify(data));
  for (const file of files) {
    const type = IMAGE_TYPES[extname(file).toLowerCase()];
    form.append('images', new Blob([readFileSync(file)], { type }), basename(file));
  }
  return form;
}

async function request(config, method, path, init = {}) {
  let response;
  try {
    response = await fetch(`${config.server}${path}`, {
      method,
      ...init,
      headers: init.headers ?? {},
    });
  } catch (error) {
    throw new AgentError(`Сервер недоступен: ${error.message}`, 4);
  }
  if (response.status === 204) {
    return { status: 204, body: null };
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 200) };
  }
  if (!response.ok) {
    const message = body?.error ?? `HTTP ${response.status}`;
    throw new AgentError(`${message} (HTTP ${response.status})`, 6);
  }
  return { status: response.status, body };
}

export async function nextJob(config) {
  const { body } = await request(config, 'GET', '/api/agent/jobs/next');
  return body;
}

export async function submitResult(config, jobId, data, files) {
  const problems = validateCollected(data);
  if (problems.length > 0) {
    throw new AgentError(`Файл с данными не подходит:\n- ${problems.join('\n- ')}`, 2);
  }
  const { body } = await request(config, 'POST', `/api/agent/jobs/${encodeURIComponent(jobId)}/result`, {
    body: buildForm(data, files),
  });
  return body;
}

export async function failJob(config, jobId, reason, final) {
  const { body } = await request(config, 'POST', `/api/agent/jobs/${encodeURIComponent(jobId)}/fail`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, final }),
  });
  return body;
}

export const WATCH_DEFAULTS = {
  intervalMs: 120000,
  pauseMs: 150000,
  maxPerDay: 10,
  runTimeoutMs: 20 * 60 * 1000,
};

export function canRunNow(startedAt, nowMs, limits = WATCH_DEFAULTS) {
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;
  const recent = startedAt.filter((time) => time > dayAgo);
  if (recent.length >= limits.maxPerDay) {
    return { ok: false, reason: `дневной предел ${limits.maxPerDay} заказов`, waitMs: Math.min(...recent) + 24 * 60 * 60 * 1000 - nowMs };
  }
  const last = Math.max(0, ...recent);
  if (last && nowMs - last < limits.pauseMs) {
    return { ok: false, reason: 'пауза между заказами', waitMs: last + limits.pauseMs - nowMs };
  }
  return { ok: true, reason: '', waitMs: 0 };
}

export function buildAgentPrompt(job, workDir, repoDir) {
  return [
    `Выполни ОДИН заказ на разбор Instagram по инструкции ${repoDir}/docs/agent/instagram-audit.md. Прочитай её целиком, правила безопасности обязательны.`,
    `Заказ уже взят из очереди, не вызывай next. id: ${job.id}. Профиль: https://www.instagram.com/${job.handle}/`,
    `Открой только этот профиль в браузере. Ничего не нажимай, кроме прокрутки и открытия постов и вкладки Reels. Лайки, подписки, сообщения, комментарии запрещены.`,
    `Скриншоты (шапка, сетка 2-3 экрана, до 3 постов, Reels) сохрани в папку ${workDir}/shots, данные запиши в ${workDir}/data.json.`,
    `Отправь: node ${repoDir}/tools/agent/ig-agent.mjs submit ${job.id} --data ${workDir}/data.json --images ${workDir}/shots`,
    `Если вход потребовал пароль, капча, действие заблокировано, профиль закрытый или не найден: node ${repoDir}/tools/agent/ig-agent.mjs fail ${job.id} "причина" (для закрытого или несуществующего добавь --final) и остановись.`,
    `В конце коротко доложи: handle, сколько картинок ушло, ответ сервера.`,
  ].join('\n');
}
