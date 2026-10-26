const STATUS_LABELS = {
  queued: 'в очереди',
  running: 'обрабатывается',
  done: 'готово',
  failed: 'не получилось',
};

const KIND_LABELS = {
  photo: 'фото',
  video: 'видео',
};

const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
};

export function pickMasters(masters, query) {
  if (!query) {
    return masters;
  }
  const needle = query.toLowerCase();
  const exact = masters.filter((master) => master.id === query);
  return exact.length > 0 ? exact : masters.filter((master) => master.name.toLowerCase().includes(needle));
}

export function mediaOf(items, masters) {
  const names = new Map(masters.map((master) => [master.id, master.name]));
  return items
    .filter((item) => names.has(item.masterId))
    .map((item) => ({ ...item, masterName: names.get(item.masterId) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function describeMedia(item) {
  const when = localStamp(item.createdAt);
  const head = `${when} · ${item.masterName} (${item.masterId}) · ${item.key} · ${KIND_LABELS[item.kind] ?? item.kind}, ${item.format} · ${STATUS_LABELS[item.status] ?? item.status}`;
  const lines = [head, `  файл ${item.id}: ${item.source.name}, ${megabytes(item.source.size)}`];
  if (item.note) {
    lines.push(`  текст мастера: ${item.note}`);
  }
  if (item.result?.note) {
    lines.push(`  обработка: ${item.result.note}`);
  }
  if (item.redos > 0) {
    lines.push(`  переделок: ${item.redos}${item.wish ? `, последнее пожелание: ${item.wish}` : ''}`);
  }
  if (item.error) {
    lines.push(`  ${item.status === 'failed' ? 'ошибка' : 'последняя переделка не удалась'}: ${item.error}`);
  }
  return lines.join('\n');
}

export function savedName(item, source) {
  const date = localStamp(item.createdAt).slice(0, 10);
  const key = item.key.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'media';
  const type = source ? item.source.type : item.result?.type;
  return `${date}-${key}-${item.id}${source ? '-source' : ''}${EXTENSIONS[type] ?? ''}`;
}

export function localStamp(iso) {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
