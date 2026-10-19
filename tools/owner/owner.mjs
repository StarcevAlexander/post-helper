#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `Управление «Помощником» из консоли (интерфейса владельца в приложении нет).

  node tools/owner/owner.mjs masters                  список мастеров и расход ИИ
  node tools/owner/owner.mjs create "Имя"             создать мастера (печатает его код один раз)
  node tools/owner/owner.mjs disable <id> | enable <id>
  node tools/owner/owner.mjs events <id> [число]      журнал действий и ответов ИИ
  node tools/owner/owner.mjs versions <id> [число]    версии данных мастера
  node tools/owner/owner.mjs restore <id> <версия>     вернуть версию данных
  node tools/owner/owner.mjs export <id> [файл.json]   выгрузить всё о мастере
  node tools/owner/owner.mjs delete <id>               удалить мастера и все его данные
  node tools/owner/owner.mjs jobs                      заказы разбора Instagram

Настройка: OWNER_SERVER и OWNER_PASSWORD в окружении или в tools/owner/.env`;

function readEnv() {
  const values = { ...process.env };
  try {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && values[match[1]] === undefined) {
        values[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    return values;
  }
  return values;
}

async function call(method, path, body) {
  const env = readEnv();
  const server = (env.OWNER_SERVER ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server) || !env.OWNER_PASSWORD) {
    throw new Error('Задайте OWNER_SERVER (адрес сервера) и OWNER_PASSWORD в tools/owner/.env');
  }
  const response = await fetch(`${server}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.OWNER_PASSWORD}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${response.status}: ${data?.error ?? text}`);
  }
  return data;
}

const MASTERS = '/api/admin/masters';

async function main([command, id, extra]) {
  switch (command) {
    case 'masters':
      return console.table((await call('GET', MASTERS)) ?? []);
    case 'create': {
      const created = await call('POST', MASTERS, { name: id });
      return console.log(`id: ${created.master.id}\nкод: ${created.code}\n(код показан один раз)`);
    }
    case 'disable':
    case 'enable':
      return console.log(await call('POST', `${MASTERS}/${id}/disabled`, { disabled: command === 'disable' }));
    case 'events':
      return console.log(JSON.stringify(await call('GET', `${MASTERS}/${id}/events?limit=${extra ?? 50}`), null, 2));
    case 'versions':
      return console.table((await call('GET', `${MASTERS}/${id}/versions?limit=${extra ?? 50}`)) ?? []);
    case 'restore':
      return console.log(await call('POST', `${MASTERS}/${id}/restore`, { version: Number(extra) }));
    case 'export': {
      const data = await call('GET', `${MASTERS}/${id}/export`);
      const file = extra ?? `master-export-${id}.json`;
      writeFileSync(file, JSON.stringify(data, null, 2));
      return console.log(`Сохранено: ${file}`);
    }
    case 'delete':
      return console.log(await call('DELETE', `${MASTERS}/${id}`));
    case 'jobs':
      return console.table((await call('GET', '/api/admin/audit-jobs?limit=50')) ?? []);
    default:
      return console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
