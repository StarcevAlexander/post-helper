import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  failRef,
  ffmpegArgs,
  mediaTypeOf,
  nextRef,
  outputName,
  parseFreeVram,
  photoWorkflow,
  submitRefs,
  videoLength,
  videoWorkflow,
  workflowFor,
} from './lib.mjs';

const TOKEN = 'agent-token-0123456789abcdef';

describe('workflows', () => {
  it('puts the prompt and the seed into the photo graph', () => {
    const graph = photoWorkflow('a cup of tea', 42, 'ph_ref_42');

    assert.equal(graph[4].inputs.prompt, 'a cup of tea');
    assert.equal(graph[6].inputs.seed, 42);
    assert.equal(graph[8].inputs.filename_prefix, 'ph_ref_42');
    assert.deepEqual(graph[6].inputs.positive, ['4', 0]);
  });

  it('puts the prompt and the seed into the video graph', () => {
    const graph = videoWorkflow('hands in motion', 7, 'ph_ref_7');

    assert.equal(graph[5].inputs.text, 'hands in motion');
    assert.equal(graph[8].inputs.seed, 7);
    assert.equal(graph[7].inputs.length, videoLength(3, 24));
  });

  it('counts video frames as 4n+1 like Wan wants', () => {
    assert.equal(videoLength(3, 24), 73);
    assert.equal(videoLength(1, 16), 17);
    assert.equal((videoLength(5, 24) - 1) % 4, 0);
  });

  it('picks the graph by the kind and refuses unknown ones', () => {
    assert.ok(workflowFor('photo', 'x', 1, 'p')[8]);
    assert.ok(workflowFor('video', 'x', 1, 'p')[11]);
    assert.throws(() => workflowFor('audio', 'x', 1, 'p'), /Неизвестный тип/);
  });

  it('makes small files for the phone', () => {
    assert.ok(ffmpegArgs('video', 'in', 'out').includes('-an'));
    assert.ok(ffmpegArgs('photo', 'in', 'out.jpg').includes('scale=640:-2'));
    assert.equal(outputName('video'), 'ref.mp4');
    assert.equal(mediaTypeOf('photo'), 'image/jpeg');
  });
});

describe('talking to the server', () => {
  let server;
  let config;
  let calls;

  before(async () => {
    calls = [];
    server = createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        calls.push({ method: request.method, url: request.url, auth: request.headers.authorization, type: request.headers['content-type'], body: Buffer.concat(chunks) });
        if (request.headers.authorization !== `Bearer ${TOKEN}`) {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end('{"error":"no"}');
          return;
        }
        if (request.url === '/api/agent/refs/next') {
          if (calls.filter((call) => call.url === request.url).length === 1) {
            response.writeHead(204);
            response.end();
            return;
          }
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ id: 'r1', key: 'w1-mon', kind: 'photo', prompts: [{ prompt: 'p', caption: 'c' }] }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    config = { server: `http://127.0.0.1:${server.address().port}`, token: TOKEN };
  });

  after(() => server.close());

  it('gets nothing from an empty queue and the item when there is one', async () => {
    assert.equal(await nextRef(config), undefined);
    const item = await nextRef(config);

    assert.equal(item.key, 'w1-mon');
    assert.equal(calls.at(-1).auth, `Bearer ${TOKEN}`);
  });

  it('uploads the files with their captions', async () => {
    await submitRefs(config, 'r1', [
      { data: Buffer.from([1, 2, 3]), mediaType: 'image/jpeg', name: 'ref.jpg', caption: 'Руки крупно' },
      { data: Buffer.from([4, 5]), mediaType: 'image/jpeg', name: 'ref.jpg', caption: 'Флаконы' },
    ]);

    const call = calls.at(-1);
    const text = call.body.toString('latin1');
    assert.equal(call.url, '/api/agent/refs/r1/result');
    assert.match(call.type, /^multipart\/form-data/);
    assert.equal((text.match(/name="files"/g) ?? []).length, 2);
    assert.ok(Buffer.from(call.body).includes(Buffer.from('["Руки крупно","Флаконы"]')));
  });

  it('reports a failure', async () => {
    await failRef(config, 'r1', 'нет GPU', true);

    const call = calls.at(-1);
    assert.equal(call.url, '/api/agent/refs/r1/fail');
    assert.deepEqual(JSON.parse(call.body.toString()), { reason: 'нет GPU', final: true });
  });

  it('knows a wrong token and an unreachable server', async () => {
    await assert.rejects(() => nextRef({ ...config, token: 'x'.repeat(30) }), (error) => error.code === 5);
    await assert.rejects(() => nextRef({ server: 'http://127.0.0.1:1', token: TOKEN }), (error) => error.code === 4);
  });
});

describe('video memory guard', () => {
  it('reads the free memory of the emptiest card', () => {
    assert.equal(parseFreeVram('6200\n'), 6200);
    assert.equal(parseFreeVram('1000\r\n15000\r\n'), 15000);
  });

  it('knows nothing when nvidia-smi says nothing', () => {
    assert.equal(parseFreeVram(''), undefined);
    assert.equal(parseFreeVram('N/A'), undefined);
  });
});
