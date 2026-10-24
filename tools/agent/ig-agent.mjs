#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentError, failJob, listImages, loadConfig, nextJob, parseArgs, submitResult } from './lib.mjs';

const HELP = `Инструмент агента «Помощника» для разбора Instagram.

Команды:
  next                          взять следующий заказ из очереди (печатает JSON; код 3, если очередь пуста)
  submit <id> --data <файл.json> --images <папка|файл> [--images ...]
                                отправить собранные данные и скриншоты (до 12 картинок)
  fail <id> "причина" [--final] вернуть заказ в очередь (или закрыть насовсем с --final)

Настройка: сервер по умолчанию http://127.0.0.1:8081 (локальный админский порт), другой адрес задаётся AGENT_SERVER в окружении или в tools/agent/.env`;

async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;
  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return 0;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const config = loadConfig(process.env, join(here, '.env'));

  if (command === 'next') {
    const job = await nextJob(config);
    if (!job) {
      console.log('NONE');
      return 3;
    }
    console.log(JSON.stringify(job, null, 2));
    return 0;
  }

  if (command === 'submit') {
    const [jobId] = rest;
    if (!jobId || typeof flags.data !== 'string') {
      throw new AgentError('Нужно: submit <id> --data <файл.json> --images <папка>', 2);
    }
    const imagePaths = argv.flatMap((item, index) => (item === '--images' ? [argv[index + 1]] : []));
    if (imagePaths.length === 0 || imagePaths.some((path) => !path || path.startsWith('--'))) {
      throw new AgentError('Укажите --images <папка или файл>', 2);
    }
    let data;
    try {
      data = JSON.parse(readFileSync(flags.data, 'utf8'));
    } catch (error) {
      throw new AgentError(`Не удалось прочитать ${flags.data}: ${error.message}`, 2);
    }
    const files = listImages(imagePaths);
    await submitResult(config, jobId, data, files);
    console.log(`OK: данные и ${files.length} скриншотов отправлены, разбор готовится на сервере`);
    return 0;
  }

  if (command === 'fail') {
    const [jobId, reason] = rest;
    if (!jobId || !reason) {
      throw new AgentError('Нужно: fail <id> "причина" [--final]', 2);
    }
    await failJob(config, jobId, reason, flags.final === true);
    console.log(flags.final === true ? 'OK: заказ закрыт с ошибкой' : 'OK: заказ возвращён в очередь');
    return 0;
  }

  throw new AgentError(`Неизвестная команда: ${command}\n\n${HELP}`, 2);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof AgentError ? `ОШИБКА: ${error.message}` : error);
    process.exit(error instanceof AgentError ? error.code : 1);
  },
);
