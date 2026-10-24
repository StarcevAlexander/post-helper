#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentError, loadConfig, parseArgs } from '../agent/lib.mjs';
import { COMFY_DEFAULTS, comfyAlive, ensureComfy, freeVramMb, makeReference, stopComfy } from './comfy.mjs';
import { MIN_FREE_VRAM_MB, failRef, nextRef, submitRefs } from './lib.mjs';

const HELP = `Воркер референсов «Помощника»: на вашем ПК делает по 3 фото к пунктам плана.

  node tools/refs/worker.mjs [--once] [--interval 120]
  node tools/refs/worker.mjs --sample "prompt" [--out папка]

  --once     взять один пункт и выйти (код 3, если очередь пуста)
  --sample   проверка без сервера: сделать один референс по промпту и сохранить в папку

Настройка: AGENT_SERVER и AGENT_TOKEN в tools/agent/.env, ComfyUI по умолчанию в ${COMFY_DEFAULTS.dir}
(переменные COMFY_DIR и COMFY_URL).`;

const here = dirname(fileURLToPath(import.meta.url));
const log = (text) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${text}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function processItem(config, comfy, item) {
  log(`${item.key}: ${item.prompts.length} кадра`);
  const files = [];
  for (const [index, prompt] of item.prompts.entries()) {
    const started = Date.now();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const made = await makeReference(comfy, prompt.prompt, seed);
    files.push({ ...made, caption: prompt.caption });
    log(`  ${index + 1}/${item.prompts.length} готов за ${Math.round((Date.now() - started) / 1000)} с, ${Math.round(made.data.length / 1024)} КБ`);
  }
  await submitRefs(config, item.id, files);
  log(`${item.key}: отправлено на сервер`);
}

async function main(argv) {
  const { flags } = parseArgs(argv);
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  let ours;
  let waitingForGpu = false;
  const release = () => {
    if (ours) {
      log('освобождаю видеокарту: останавливаю ComfyUI');
      stopComfy(ours);
      ours = undefined;
    }
  };
  process.on('SIGINT', () => {
    release();
    process.exit(0);
  });
  const comfy = { dir: process.env.COMFY_DIR ?? COMFY_DEFAULTS.dir, url: process.env.COMFY_URL ?? COMFY_DEFAULTS.url };

  if (flags.sample) {
    await ensureComfy(comfy, log);
    const started = Date.now();
    const made = await makeReference(comfy, String(flags.sample), Math.floor(Math.random() * 2 ** 31));
    const out = resolve(String(flags.out ?? '.'), made.name);
    writeFileSync(out, made.data);
    log(`фото: ${Math.round((Date.now() - started) / 1000)} с, ${Math.round(made.data.length / 1024)} КБ -> ${out}`);
    return 0;
  }

  const config = loadConfig(process.env, join(here, '..', 'agent', '.env'));
  const interval = (flags.interval ? Number(flags.interval) : 120) * 1000;
  log(`слежу за очередью референсов ${config.server}`);
  for (;;) {
    if (!(await comfyAlive(comfy.url))) {
      const free = freeVramMb();
      if (free !== undefined && free < MIN_FREE_VRAM_MB) {
        if (!waitingForGpu) {
          log(`видеокарта занята (свободно ${free} МБ из нужных ${MIN_FREE_VRAM_MB}), жду, попытки не тратятся`);
          waitingForGpu = true;
        }
        if (flags.once) {
          return 4;
        }
        await sleep(interval);
        continue;
      }
    }
    waitingForGpu = false;
    let item;
    try {
      item = await nextRef(config);
    } catch (error) {
      if (error instanceof AgentError && error.code === 5) {
        throw error;
      }
      log(`очередь недоступна: ${error.message}`);
    }
    if (item) {
      try {
        ours = (await ensureComfy(comfy, log)) ?? ours;
        await processItem(config, comfy, item);
      } catch (error) {
        log(`ошибка: ${error.message}`);
        await failRef(config, item.id, 'Не удалось сделать референсы на ПК', false).catch(() => undefined);
      }
      if (flags.once) {
        release();
        return 0;
      }
      continue;
    }
    release();
    if (flags.once) {
      log('очередь пуста');
      return 3;
    }
    await sleep(interval);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof AgentError ? error.message : error);
    process.exit(error instanceof AgentError ? error.code : 1);
  },
);
