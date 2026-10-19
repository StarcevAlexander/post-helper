import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

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

export function loadConfig(env, envFile) {
  const fromFile = envFile && existsSync(envFile) ? parseEnvText(readFileSync(envFile, 'utf8')) : {};
  const server = (env.AGENT_SERVER ?? fromFile.AGENT_SERVER ?? '').trim().replace(/\/+$/, '');
  const token = (env.AGENT_TOKEN ?? fromFile.AGENT_TOKEN ?? '').trim();
  if (!server) {
    throw new AgentError('Не задан AGENT_SERVER (адрес сервера, например https://post-helper-server.onrender.com)', 2);
  }
  if (!/^https?:\/\//.test(server)) {
    throw new AgentError('AGENT_SERVER должен начинаться с http:// или https://', 2);
  }
  if (token.length < 24) {
    throw new AgentError('Не задан AGENT_TOKEN (не короче 24 символов)', 2);
  }
  return { server, token };
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
  for (const field of ['name', 'bio', 'externalUrl', 'category', 'notes']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      problems.push(`поле ${field} должно быть строкой`);
    }
  }
  for (const field of NUMBER_FIELDS) {
    if (!isCount(data[field])) {
      problems.push(`поле ${field} должно быть целым числом не меньше нуля или null`);
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
      headers: { Authorization: `Bearer ${config.token}`, ...(init.headers ?? {}) },
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
    throw new AgentError(`${message} (HTTP ${response.status})`, response.status === 401 ? 5 : 6);
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
