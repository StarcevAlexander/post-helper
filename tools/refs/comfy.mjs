import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentError } from '../agent/lib.mjs';
import { ffmpegArgs, mediaTypeOf, outputName, parseFreeVram, workflowFor } from './lib.mjs';

export const COMFY_DEFAULTS = {
  dir: 'C:/Users/master/WebstormProjects/test/ComfyUI',
  url: 'http://127.0.0.1:8188',
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function json(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

export function freeVramMb() {
  const result = spawnSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { stdio: 'pipe' });
  return result.status === 0 ? parseFreeVram(String(result.stdout)) : undefined;
}

export async function comfyAlive(url) {
  try {
    await json(`${url}/system_stats`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureComfy(options, log) {
  if (await comfyAlive(options.url)) {
    return undefined;
  }
  const python = join(options.dir, 'venv', 'Scripts', 'python.exe');
  if (!existsSync(python)) {
    throw new AgentError(`ComfyUI не найден: ${python}`, 2);
  }
  log('запускаю ComfyUI');
  const port = new URL(options.url).port || '8188';
  const child = spawn(python, ['main.py', '--listen', '127.0.0.1', '--port', port], {
    cwd: options.dir,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await sleep(2000);
    if (await comfyAlive(options.url)) {
      return child;
    }
  }
  child.kill();
  throw new AgentError('ComfyUI не поднялся за 3 минуты', 2);
}

export function stopComfy(child) {
  if (!child?.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill();
}

export async function runWorkflow(url, workflow, timeoutMs) {
  const queued = await json(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  const started = Date.now();
  for (;;) {
    await sleep(3000);
    if (Date.now() - started > timeoutMs) {
      throw new AgentError('Генерация заняла слишком много времени', 2);
    }
    const history = await json(`${url}/history/${queued.prompt_id}`);
    const entry = history[queued.prompt_id];
    if (!entry) {
      continue;
    }
    if (entry.status?.status_str === 'error') {
      throw new AgentError(`ComfyUI вернул ошибку: ${JSON.stringify(entry.status.messages?.at(-1) ?? entry.status)}`, 2);
    }
    for (const node of Object.values(entry.outputs ?? {})) {
      const item = [...(node.images ?? []), ...(node.videos ?? [])][0];
      if (item) {
        const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? '', type: item.type ?? 'output' });
        const response = await fetch(`${url}/view?${query}`);
        return { data: Buffer.from(await response.arrayBuffer()), name: item.filename };
      }
    }
    if (entry.status?.completed) {
      throw new AgentError('ComfyUI закончил, но файла нет', 2);
    }
  }
}

export function compress(kind, raw, name) {
  const dir = mkdtempSync(join(tmpdir(), 'ph-ref-'));
  try {
    const input = join(dir, `in-${name}`);
    const output = join(dir, outputName(kind));
    writeFileSync(input, raw);
    const result = spawnSync('ffmpeg', ffmpegArgs(kind, input, output), { stdio: 'pipe' });
    if (result.status !== 0) {
      throw new AgentError(`ffmpeg не справился: ${String(result.stderr).slice(-300)}`, 2);
    }
    return { data: readFileSync(output), mediaType: mediaTypeOf(kind), name: outputName(kind) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function makeReference(options, kind, prompt, seed) {
  const timeout = kind === 'video' ? 20 * 60 * 1000 : 6 * 60 * 1000;
  const raw = await runWorkflow(options.url, workflowFor(kind, prompt, seed, `ph_ref_${seed}`), timeout);
  return compress(kind, raw.data, raw.name);
}
