import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  AgentError,
  buildAgentPrompt,
  canRunNow,
  failJob,
  listImages,
  loadConfig,
  MAX_IMAGES,
  nextJob,
  parseArgs,
  parseEnvText,
  submitResult,
  validateCollected,
} from './lib.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('parseArgs', () => {
  it('splits words and flags', () => {
    const { positional, flags } = parseArgs(['submit', 'abc', '--data', 'a.json', '--final', '--images', 'dir']);

    assert.deepEqual(positional, ['submit', 'abc']);
    assert.equal(flags.data, 'a.json');
    assert.equal(flags.final, true);
    assert.equal(flags.images, 'dir');
  });
});

describe('parseEnvText and loadConfig', () => {
  it('reads keys, ignores comments and strips quotes', () => {
    const values = parseEnvText('# note\nAGENT_SERVER="https://x.example"\n\nAGENT_PORT = abc \nBAD LINE\n');

    assert.deepEqual(values, { AGENT_SERVER: 'https://x.example', AGENT_PORT: 'abc' });
  });

  it('takes the environment first and trims the slash', () => {
    const config = loadConfig({ AGENT_SERVER: 'https://x.example///' }, undefined);

    assert.deepEqual(config, { server: 'https://x.example' });
  });

  it('uses the local admin port when no address is given and refuses a bad address', () => {
    assert.deepEqual(loadConfig({}, undefined), { server: 'http://127.0.0.1:8081' });
    assert.throws(() => loadConfig({ AGENT_SERVER: 'x.example' }, undefined), /http/);
  });
});

describe('validateCollected', () => {
  const good = {
    handle: 'anna_nails',
    name: 'Анна',
    bio: 'Маникюр',
    followers: 1250,
    following: null,
    highlights: ['Работы'],
    posts: [{ type: 'reel', caption: 'Нюд', likes: 12, comments: 0, views: null, date: '2026-10-12', url: 'https://x' }],
  };

  it('accepts a complete profile and a minimal one', () => {
    assert.deepEqual(validateCollected(good), []);
    assert.deepEqual(validateCollected({ handle: 'a' }), []);
  });

  it('accepts the place from the header and the geotags of the posts', () => {
    const withPlace = { ...good, location: 'Ангарск, 7 микрорайон', geoTags: [{ name: 'Ангарск', count: 12 }, { name: 'Иркутск', count: null }] };

    assert.deepEqual(validateCollected(withPlace), []);
  });

  it('refuses broken place data', () => {
    const problems = validateCollected({ handle: 'a', location: 5, geoTags: [{ name: '', count: 1 }, { name: 'x', count: -2 }, 'y'] });

    assert.equal(problems.length, 4);
    assert.ok(problems.some((text) => text.includes('location')));
    assert.ok(problems.some((text) => text.includes('геометка 2')));
    assert.deepEqual(validateCollected({ handle: 'a', geoTags: 'нет' }), ['поле geoTags должно быть списком']);
  });

  it('names every problem', () => {
    const problems = validateCollected({
      handle: '',
      bio: 5,
      followers: -1,
      highlights: [1],
      posts: [{ likes: 1.5, caption: 7 }, 'x'],
    });

    assert.equal(problems.length, 7);
    assert.ok(problems.some((text) => text.includes('handle')));
    assert.ok(problems.some((text) => text.includes('followers')));
    assert.ok(problems.some((text) => text.includes('публикация 1: поле likes')));
    assert.ok(problems.some((text) => text.includes('публикация 2')));
  });

  it('refuses anything that is not an object', () => {
    assert.equal(validateCollected(null).length, 1);
    assert.equal(validateCollected([]).length, 1);
    assert.equal(validateCollected('x').length, 1);
  });
});

describe('listImages', () => {
  const root = mkdtempSync(join(tmpdir(), 'ig-agent-'));
  const shots = join(root, 'shots');
  mkdirSync(shots);
  for (const name of ['b.png', 'a.jpg', 'notes.txt', 'c.WEBP']) {
    writeFileSync(join(shots, name), PNG);
  }
  after(() => rmSync(root, { recursive: true, force: true }));

  it('takes only pictures from a folder, in name order', () => {
    const files = listImages([shots]);

    assert.deepEqual(files.map((file) => file.split(/[\\/]/).pop()), ['a.jpg', 'b.png', 'c.WEBP']);
  });

  it('accepts single files and refuses other ones', () => {
    assert.equal(listImages([join(shots, 'a.jpg')]).length, 1);
    assert.throws(() => listImages([join(shots, 'notes.txt')]), /Не картинка/);
    assert.throws(() => listImages([join(root, 'missing')]), /Нет такого/);
  });

  it('refuses an empty folder and too many pictures', () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    const many = join(root, 'many');
    mkdirSync(many);
    for (let index = 0; index <= MAX_IMAGES; index += 1) {
      writeFileSync(join(many, `${String(index).padStart(2, '0')}.png`), PNG);
    }

    assert.throws(() => listImages([empty]), /ни одной/);
    assert.throws(() => listImages([many]), /не больше/);
  });
});

describe('talking to the server', () => {
  let server;
  let config;
  let calls;
  let nextResponse;

  before(async () => {
    calls = [];
    server = createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks);
        calls.push({ method: request.method, url: request.url, type: request.headers['content-type'], body });
        if (request.url === '/api/agent/jobs/next') {
          if (!nextResponse) {
            response.writeHead(204);
            response.end();
            return;
          }
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(nextResponse));
          return;
        }
        if (request.url.endsWith('/result') && body.includes('anna_nails') === false) {
          response.writeHead(409, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Заказ в другом состоянии' }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    config = { server: `http://127.0.0.1:${server.address().port}` };
  });

  after(() => server.close());

  it('returns null when the queue is empty and the job when there is one', async () => {
    nextResponse = null;
    assert.equal(await nextJob(config), null);

    nextResponse = { id: 'j1', handle: 'anna_nails', attempts: 1, profile: { specialty: 'маникюр' } };
    const job = await nextJob(config);

    assert.equal(job.handle, 'anna_nails');
  });

  it('uploads the data and the pictures as a form', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ig-agent-up-'));
    writeFileSync(join(root, 'a.png'), PNG);
    writeFileSync(join(root, 'b.png'), PNG);

    await submitResult(config, 'j1', { handle: 'anna_nails', followers: 5 }, listImages([root]));

    const call = calls.at(-1);
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/api/agent/jobs/j1/result');
    assert.match(call.type, /^multipart\/form-data/);
    const text = call.body.toString('latin1');
    assert.equal((text.match(/name="images"/g) ?? []).length, 2);
    assert.ok(text.includes('name="data"'));
    assert.ok(text.includes('"followers":5'));
    rmSync(root, { recursive: true, force: true });
  });

  it('checks the data before sending anything', async () => {
    const before = calls.length;

    await assert.rejects(() => submitResult(config, 'j1', { handle: '' }, []), /Файл с данными не подходит/);

    assert.equal(calls.length, before);
  });

  it('explains a refusal of the server', async () => {
    await assert.rejects(
      () => submitResult(config, 'j1', { handle: 'x' }, []),
      (error) => error instanceof AgentError && /другом состоянии/.test(error.message) && error.code === 6,
    );
  });

  it('reports a failure as json', async () => {
    await failJob(config, 'j1', 'Профиль закрытый', true);

    const call = calls.at(-1);
    assert.equal(call.url, '/api/agent/jobs/j1/fail');
    assert.deepEqual(JSON.parse(call.body.toString()), { reason: 'Профиль закрытый', final: true });
  });

  it('tells about an unreachable server', async () => {
    await assert.rejects(() => nextJob({ server: 'http://127.0.0.1:1' }), (error) => error.code === 4);
  });
});

describe('watch rules', () => {
  const limits = { intervalMs: 1000, pauseMs: 150000, maxPerDay: 3, runTimeoutMs: 1000 };
  const now = 10 * 24 * 60 * 60 * 1000;

  it('lets the first order go', () => {
    assert.equal(canRunNow([], now, limits).ok, true);
  });

  it('keeps a pause between two orders', () => {
    const gate = canRunNow([now - 60000], now, limits);

    assert.equal(gate.ok, false);
    assert.equal(gate.waitMs, 90000);
  });

  it('stops at the daily limit and frees a slot after a day', () => {
    const long = [now - 5000000, now - 4000000, now - 3000000];

    assert.equal(canRunNow(long, now, limits).ok, false);
    assert.equal(canRunNow(long, now + 24 * 60 * 60 * 1000 - 4900000, limits).ok, true);
  });

  it('builds a prompt that names the order, the profile and the commands', () => {
    const prompt = buildAgentPrompt({ id: 'j1', handle: 'anna_nails' }, '/tmp/w', '/repo');

    assert.match(prompt, /j1/);
    assert.match(prompt, /instagram\.com\/anna_nails\//);
    assert.match(prompt, /ig-agent\.mjs submit j1/);
    assert.match(prompt, /ig-agent\.mjs fail j1/);
  });
});
