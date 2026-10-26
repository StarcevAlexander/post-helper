import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeMedia, localStamp, mediaOf, pickMasters, savedName } from './media-list.mjs';

const masters = [
  { id: 'd44134e70fa3b235', name: 'Евгения Щербелёва' },
  { id: 'a8b2a5e4e0b06502', name: 'Евгения (массаж)' },
  { id: '4ad64d6cec619ed8', name: 'Александр Старцев' },
];

function item(overrides = {}) {
  return {
    id: 'm1',
    masterId: 'd44134e70fa3b235',
    key: 'w1-mon',
    kind: 'video',
    format: 'reels',
    status: 'done',
    error: '',
    note: '',
    createdAt: '2026-10-26T17:50:48Z',
    source: { name: 'IMG_0001.MOV', type: 'video/quicktime', size: 9502762 },
    result: { type: 'video/mp4', note: 'Подровнял под 9:16' },
    redos: 0,
    ...overrides,
  };
}

test('picks masters by exact id or by a part of the name', () => {
  assert.deepEqual(pickMasters(masters, 'a8b2a5e4e0b06502').map((master) => master.id), ['a8b2a5e4e0b06502']);
  assert.equal(pickMasters(masters, 'евгения').length, 2);
  assert.equal(pickMasters(masters, undefined).length, 3);
  assert.equal(pickMasters(masters, 'нет такой').length, 0);
});

test('keeps only the chosen masters, names them and puts the newest first', () => {
  const listed = mediaOf(
    [item({ id: 'old', createdAt: '2026-10-25T10:00:00Z' }), item({ id: 'new' }), item({ id: 'other', masterId: '4ad64d6cec619ed8' })],
    pickMasters(masters, 'евгения'),
  );

  assert.deepEqual(listed.map((entry) => entry.id), ['new', 'old']);
  assert.equal(listed[0].masterName, 'Евгения Щербелёва');
});

test('describes the file, the processing, the redo and a failure in plain words', () => {
  const [ready] = mediaOf([item({ note: 'Снимаю гель-лак', redos: 1, wish: 'ярче' })], masters);
  const text = describeMedia(ready);

  assert.ok(text.startsWith(`${localStamp('2026-10-26T17:50:48Z')} · Евгения Щербелёва`));
  assert.match(text, /видео, reels · готово/);
  assert.match(text, /IMG_0001\.MOV, 9\.1 МБ/);
  assert.match(text, /текст мастера: Снимаю гель-лак/);
  assert.match(text, /переделок: 1, последнее пожелание: ярче/);

  const [failed] = mediaOf([item({ status: 'failed', error: 'ffmpeg упал', result: undefined })], masters);
  assert.match(describeMedia(failed), /не получилось[\s\S]*ошибка: ffmpeg упал/);
});

test('names saved files by date, publication and id with the right extension', () => {
  const day = localStamp('2026-10-26T17:50:48Z').slice(0, 10);

  assert.equal(savedName(item(), false), `${day}-w1-mon-m1.mp4`);
  assert.equal(savedName(item(), true), `${day}-w1-mon-m1-source.mov`);
  assert.equal(savedName(item({ key: 'w1/../mon' }), false), `${day}-w1_mon-m1.mp4`);
});

test('shows the local time of the upload', () => {
  assert.match(localStamp('2026-10-26T17:50:48Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
