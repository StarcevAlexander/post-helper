#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewStats, describeReviewStats } from './review-stats.mjs';

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

Заявки на контент-план:
  node tools/owner/owner.mjs intakes [new|ready]       заявки мастеров: ссылки, цели, пожелания (по умолчанию новые)
  node tools/owner/owner.mjs plan <id> <план.json>     залить мастеру стратегию, календарь и комплекты, закрыть заявку
  node tools/owner/owner.mjs refs <id> <ключ> <файл> [файл] [файл] [--captions "подпись 1|подпись 2|подпись 3"]
                                                      залить до 3 референсов (фото или видео) к публикации календаря
  node tools/owner/owner.mjs review <id> [--json]      выполнение плана: проценты по неделям, форматам, рубрикам, просрочки, итоги недели
  node tools/owner/owner.mjs refs-clear <id>          удалить референсы мастера целиком (по всем публикациям)
  node tools/owner/owner.mjs push <id> "Заголовок" ["Текст"] [--url "./?screen=today"]
                                                      отправить мастеру уведомление на телефон (если он включил их в настройках)

Настройка: OWNER_SERVER и OWNER_PASSWORD в окружении или в tools/owner/.env`;

const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

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
  const form = body instanceof FormData;
  const headers = { Authorization: `Bearer ${env.OWNER_PASSWORD}` };
  if (!form) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${server}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${response.status}: ${data?.error ?? text}`);
  }
  return data;
}

function toLocalDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function describeIntake(request) {
  const lines = [
    `Заявка ${request.id} · ${request.status === 'ready' ? 'готова' : 'новая'} · ${request.createdAt}`,
    `Мастер: ${request.masterName || '?'} (id ${request.masterId})`,
    'Соцсети:',
    ...request.networks.map((network) => `  • ${network.platform}: ${network.url}`),
    ...(request.references?.length
      ? [
          'Референсы (чей контент и стиль взять за образец или переработать):',
          ...request.references.map((reference) => `  • ${reference.platform}: ${reference.url}`),
        ]
      : ['Референсов нет']),
    'Цели:',
    ...(request.goalTitles ?? request.goals).map((goal) => `  • ${goal}`),
    request.note ? `Пожелания и рекомендации (обязательно учесть в плане):\n  ${request.note.replace(/\n/g, '\n  ')}` : 'Пожеланий нет',
  ];
  return lines.join('\n');
}

function parseRefsArguments(args) {
  const files = [];
  let captions = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--captions') {
      captions = (args[index + 1] ?? '').split('|').map((caption) => caption.trim());
      index += 1;
    } else {
      files.push(args[index]);
    }
  }
  return { files, captions };
}

function parsePushArguments(args) {
  const texts = [];
  let url = '';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--url') {
      url = args[index + 1] ?? '';
      index += 1;
    } else {
      texts.push(args[index]);
    }
  }
  return { body: texts.join(' '), url };
}

function refsForm(files, captions) {
  const form = new FormData();
  files.forEach((file) => {
    const type = MEDIA_TYPES[extname(file).toLowerCase()];
    if (!type) {
      throw new Error(`Формат не поддерживается: ${file} (нужны png, jpg, webp, mp4, webm)`);
    }
    form.append('files', new Blob([readFileSync(file)], { type }), basename(file));
  });
  if (captions.length > 0) {
    form.append('data', JSON.stringify(captions));
  }
  return form;
}

const MASTERS = '/api/admin/masters';

async function main([command, id, extra, ...rest]) {
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
    case 'intakes': {
      const status = id ?? 'new';
      const requests = (await call('GET', `/api/admin/intakes?status=${status}&limit=50`)) ?? [];
      return console.log(requests.length > 0 ? requests.map(describeIntake).join('\n\n') : 'Заявок нет');
    }
    case 'plan': {
      if (!id || !extra) {
        throw new Error('Нужно: plan <id мастера> <план.json>');
      }
      const plan = JSON.parse(readFileSync(extra, 'utf8'));
      return console.log(await call('POST', `${MASTERS}/${id}/plan`, plan));
    }
    case 'push': {
      if (!id || !extra) {
        throw new Error('Нужно: push <id мастера> "Заголовок" ["Текст"] [--url "./..."]');
      }
      const { body, url } = parsePushArguments(rest);
      const result = await call('POST', `${MASTERS}/${id}/push`, { title: extra, body, url });
      return console.log(
        result.sent > 0
          ? `Отправлено на устройств: ${result.sent}`
          : 'Не отправлено: у мастера нет устройств с включёнными уведомлениями',
      );
    }
    case 'refs': {
      const { files, captions } = parseRefsArguments([extra, ...rest].filter((value) => value !== undefined));
      const key = files.shift();
      if (!id || !key || files.length === 0) {
        throw new Error('Нужно: refs <id мастера> <ключ публикации> <файл> [файл] [файл]');
      }
      return console.log(await call('POST', `${MASTERS}/${id}/refs/${encodeURIComponent(key)}`, refsForm(files, captions)));
    }
    case 'review': {
      if (!id) {
        throw new Error('Нужно: review <id мастера> [--json]');
      }
      const stats = buildReviewStats(await call('GET', `${MASTERS}/${id}/export`), toLocalDateKey(new Date()));
      return console.log(extra === '--json' ? JSON.stringify(stats, null, 2) : describeReviewStats(stats));
    }
    case 'refs-clear': {
      if (!id) {
        throw new Error('Нужно: refs-clear <id мастера>');
      }
      await call('DELETE', `${MASTERS}/${id}/refs`);
      return console.log('Референсы мастера удалены');
    }
    default:
      return console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
