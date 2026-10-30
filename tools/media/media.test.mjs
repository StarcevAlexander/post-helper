import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  assTime,
  audioArgs,
  buildAss,
  buildFilterChain,
  defaultPlan,
  downloadSource,
  escapeAss,
  extensionFor,
  failMedia,
  hasSubtitles,
  nextMedia,
  parseProbe,
  parseSubs,
  isHallucination,
  parseWhisper,
  photoArgs,
  presetFilter,
  previewArgs,
  requestPlan,
  rotationOf,
  sanitizePlan,
  scaleCropFilter,
  sizeFor,
  submitResult,
  thumbArgs,
  videoArgs,
  whisperArgs,
  whisperPlan,
} from './lib.mjs';

describe('formats and filters', () => {
  it('picks the size by the format', () => {
    assert.deepEqual(sizeFor('reels'), { width: 1080, height: 1920 });
    assert.deepEqual(sizeFor('stories'), { width: 1080, height: 1920 });
    assert.deepEqual(sizeFor('post'), { width: 1080, height: 1350 });
    assert.throws(() => sizeFor('square'), /Неизвестный формат/);
  });

  it('covers the frame and shifts the crop by the focus', () => {
    assert.equal(
      scaleCropFilter(1080, 1920, 'top'),
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)/2:0',
    );
    assert.match(scaleCropFilter(1080, 1350, 'center'), /crop=1080:1350:\(iw-ow\)\/2:\(ih-oh\)\/2$/);
    assert.match(scaleCropFilter(1080, 1350, 'bottom'), /:ih-oh$/);
    assert.match(scaleCropFilter(1080, 1350, 'weird'), /:\(ih-oh\)\/2$/);
  });

  it('knows the presets and falls back to clean', () => {
    assert.equal(presetFilter('none'), '');
    assert.match(presetFilter('warm'), /^eq=contrast=1\.06:saturation=1\.08,unsharp=5:5:0\.4,colorbalance=rs=0\.04:gs=0\.01:bs=-0\.04$/);
    assert.match(presetFilter('cool'), /colorbalance=rs=-0\.03:bs=0\.05$/);
    assert.match(presetFilter('soft'), /^eq=contrast=0\.96:brightness=0\.02:saturation=1\.02$/);
    assert.match(presetFilter('bright'), /^eq=brightness=0\.06:contrast=1\.04:saturation=1\.05,unsharp=5:5:0\.3$/);
    assert.equal(presetFilter('nope'), presetFilter('clean'));
  });

  it('builds the chain with a relative ass path last', () => {
    const chain = buildFilterChain({ format: 'reels', focus: 'center', preset: 'warm', withAss: true });
    assert.ok(chain.startsWith('scale=1080:1920'));
    assert.ok(chain.endsWith(',ass=subs.ass'));
    assert.ok(!buildFilterChain({ format: 'post', focus: 'top', preset: 'none', withAss: false }).includes('ass='));
    assert.ok(!buildFilterChain({ format: 'post', focus: 'top', preset: 'none', withAss: false }).endsWith(','));
  });
});

describe('ffmpeg arguments', () => {
  it('encodes video with nvenc or x264 and keeps or drops the sound', () => {
    const nvenc = videoArgs({ input: 'in.mp4', output: 'result.mp4', filters: 'f', encoder: 'nvenc', hasAudio: true });
    assert.deepEqual(nvenc.slice(0, 5), ['-y', '-i', 'in.mp4', '-vf', 'f']);
    assert.ok(nvenc.join(' ').includes('-c:v h264_nvenc -preset p5 -cq 23 -b:v 0'));
    assert.ok(nvenc.join(' ').includes('-pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -movflags +faststart'));
    assert.equal(nvenc.at(-1), 'result.mp4');
    const x264 = videoArgs({ input: 'in.mp4', output: 'result.mp4', filters: 'f', encoder: 'x264', hasAudio: false });
    assert.ok(x264.join(' ').includes('-c:v libx264 -crf 20 -preset medium'));
    assert.ok(x264.includes('-an'));
    assert.ok(!x264.includes('aac'));
  });

  it('makes a one frame jpeg for the photo and a poster for both', () => {
    assert.deepEqual(photoArgs({ input: 'in.jpg', output: 'result.jpg', filters: 'f' }), ['-y', '-i', 'in.jpg', '-vf', 'f', '-frames:v', '1', '-q:v', '2', 'result.jpg']);
    assert.ok(thumbArgs('video', 'result.mp4', 'thumb.jpg').join(' ').startsWith('-y -ss 0.5 -i result.mp4'));
    assert.ok(!thumbArgs('photo', 'result.jpg', 'thumb.jpg').includes('-ss'));
    assert.ok(thumbArgs('photo', 'result.jpg', 'thumb.jpg').includes('scale=540:-2'));
  });

  it('takes the preview in the middle of a short video and at one second of a long one', () => {
    assert.ok(previewArgs('video', 'in.mp4', 'p.jpg', 1000).join(' ').includes('-ss 0.5'));
    assert.ok(previewArgs('video', 'in.mp4', 'p.jpg', 20000).join(' ').includes('-ss 1'));
    assert.ok(!previewArgs('photo', 'in.jpg', 'p.jpg').includes('-ss'));
    assert.ok(previewArgs('photo', 'in.jpg', 'p.jpg').includes('scale=640:-2'));
  });

  it('extracts mono 16 kHz audio', () => {
    assert.deepEqual(audioArgs('in.mp4', 'audio.wav'), ['-y', '-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', 'audio.wav']);
  });

  it('names the source file by the type, then by the name', () => {
    assert.equal(extensionFor('video/quicktime'), 'mov');
    assert.equal(extensionFor('image/heic'), 'heic');
    assert.equal(extensionFor('application/octet-stream', 'IMG_1.MP4'), 'mp4');
    assert.equal(extensionFor('application/octet-stream', 'noext'), 'bin');
  });
});

describe('probe', () => {
  const video = (extra = {}) =>
    JSON.stringify({
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, ...extra },
        { codec_type: 'audio' },
      ],
      format: { duration: '14.8' },
    });

  it('reads the size, the length and the sound', () => {
    assert.deepEqual(parseProbe(video()), { width: 1920, height: 1080, durationMs: 14800, hasAudio: true });
  });

  it('swaps the sides for a quarter turn from side data or a tag', () => {
    assert.equal(parseProbe(video({ side_data_list: [{ rotation: -90 }] })).width, 1080);
    assert.equal(parseProbe(video({ tags: { rotate: '270' } })).height, 1920);
    assert.equal(parseProbe(video({ side_data_list: [{ rotation: 180 }] })).width, 1920);
    assert.equal(rotationOf({ side_data_list: [{ rotation: -90 }] }), 270);
    assert.equal(rotationOf({}), 0);
  });

  it('handles a photo without sound and refuses garbage', () => {
    const photo = parseProbe(JSON.stringify({ streams: [{ codec_type: 'video', width: 4000, height: 3000 }], format: {} }));
    assert.deepEqual(photo, { width: 4000, height: 3000, durationMs: 0, hasAudio: false });
    assert.throws(() => parseProbe('oops'), /не JSON/);
    assert.throws(() => parseProbe(JSON.stringify({ streams: [{ codec_type: 'audio' }] })), /нет изображения/);
  });
});

describe('whisper', () => {
  it('uses the card with the big model when memory is free', () => {
    const plan = whisperPlan(8000, {});
    assert.equal(plan.model, 'large-v3-turbo');
    assert.deepEqual(plan.extra, []);
    assert.equal(whisperPlan(8000, { WHISPER_MODEL: 'medium' }).model, 'medium');
  });

  it('falls to the processor with the small model when memory is short or unknown', () => {
    for (const free of [3999, 0, undefined]) {
      const plan = whisperPlan(free, { WHISPER_MODEL: 'medium' });
      assert.equal(plan.model, 'small');
      assert.deepEqual(plan.extra, ['--device', 'cpu', '--fp16', 'False']);
    }
  });

  it('builds the command', () => {
    const args = whisperArgs('audio.wav', 'tmp', whisperPlan(1000));
    assert.deepEqual(args.slice(0, 9), ['audio.wav', '--model', 'small', '--language', 'ru', '--task', 'transcribe', '--output_format', 'json']);
    assert.ok(args.join(' ').includes('--output_dir tmp --device cpu --fp16 False'));
  });

  it('keeps only the useful segments from the json', () => {
    const text = JSON.stringify({
      segments: [
        { start: 0, end: 2.4, text: ' привет ' },
        { start: 2.4, end: 2.4, text: 'пусто по времени' },
        { start: 3, end: 4, text: '   ' },
        { start: 4, end: 5, text: 'пока', id: 3 },
      ],
    });
    assert.deepEqual(parseWhisper(text), [
      { start: 0, end: 2.4, text: 'привет' },
      { start: 4, end: 5, text: 'пока' },
    ]);
    assert.deepEqual(parseWhisper('не json'), []);
    assert.deepEqual(parseWhisper('{}'), []);
  });

  it('drops whisper hallucinations on silence and music', () => {
    const text = JSON.stringify({
      segments: [
        { start: 0, end: 2, text: ' Продолжение следует...', no_speech_prob: 0.1, avg_logprob: -0.3 },
        { start: 2, end: 4, text: ' Привет', no_speech_prob: 0.9, avg_logprob: -0.3 },
        { start: 4, end: 6, text: ' Привет', no_speech_prob: 0.1, avg_logprob: -1.5 },
        { start: 6, end: 8, text: ' Привет привет привет', no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 3 },
        { start: 8, end: 10, text: ' Начинаем маникюр', no_speech_prob: 0.2, avg_logprob: -0.4, compression_ratio: 1.1 },
      ],
    });
    assert.deepEqual(parseWhisper(text), [{ start: 8, end: 10, text: 'Начинаем маникюр' }]);
    assert.equal(isHallucination({ text: 'Привет' }), false);
  });
});

describe('subtitles', () => {
  it('formats ass time', () => {
    assert.equal(assTime(0), '0:00:00.00');
    assert.equal(assTime(2.4), '0:00:02.40');
    assert.equal(assTime(61.255), '0:01:01.26');
    assert.equal(assTime(3725.5), '1:02:05.50');
  });

  it('escapes the text for ass', () => {
    assert.equal(escapeAss('Привет\nмир'), 'Привет\\Nмир');
    assert.equal(escapeAss('{\\an9}Тест}'), 'an9Тест');
    assert.equal(escapeAss('  \n  '), '');
  });

  it('writes styles sized by the height and both kinds of lines', () => {
    const ass = buildAss({
      title: 'До и после',
      subtitles: [
        { start: 0, end: 2.4, text: 'Привет!\nЭто тест' },
        { start: 3, end: 3, text: 'пропадёт' },
      ],
      width: 1080,
      height: 1920,
      durationMs: 14800,
    });
    assert.ok(ass.includes('PlayResX: 1080'));
    assert.ok(ass.includes('PlayResY: 1920'));
    assert.ok(ass.includes('Style: Sub,Arial,73,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,65,65,346,1'));
    assert.ok(ass.includes('Style: Title,Arial,96,'));
    assert.ok(ass.includes(',1,3,1,8,65,65,230,1'));
    assert.ok(ass.includes('Dialogue: 0,0:00:00.00,0:00:04.00,Title,,0,0,0,,До и после'));
    assert.ok(ass.includes('Dialogue: 0,0:00:00.00,0:00:02.40,Sub,,0,0,0,,Привет!\\NЭто тест'));
    assert.ok(!ass.includes('пропадёт'));
  });

  it('limits the title to a short video and shows it all along on a photo', () => {
    const short = buildAss({ title: 'Т', subtitles: [], width: 1080, height: 1920, durationMs: 2500 });
    assert.ok(short.includes('0:00:00.00,0:00:02.50,Title'));
    const photo = buildAss({ title: 'Т', subtitles: [], width: 1080, height: 1350, durationMs: 0, font: 'Roboto' });
    assert.ok(photo.includes('0:00:00.00,10:00:00.00,Title'));
    assert.ok(photo.includes('Style: Title,Roboto,68,'));
  });

  it('parses the sample subs flag', () => {
    assert.deepEqual(parseSubs('0-2:Привет|2.5-4:Пока: до встречи|bad|5-4:x'), [
      { start: 0, end: 2, text: 'Привет' },
      { start: 2.5, end: 4, text: 'Пока: до встречи' },
    ]);
    assert.deepEqual(parseSubs(''), []);
  });

  it('tells whether there is anything to show', () => {
    assert.equal(hasSubtitles([]), false);
    assert.equal(hasSubtitles([{ start: 0, end: 1, text: ' ' }]), false);
    assert.equal(hasSubtitles([{ start: 0, end: 1, text: 'а' }]), true);
  });
});

describe('plan', () => {
  it('keeps a good plan', () => {
    const plan = sanitizePlan({ preset: 'warm', focus: 'top', title: ' Заголовок ', subtitles: [{ start: 0, end: 1, text: 'Привет' }], note: 'Сделал' });
    assert.deepEqual(plan, { preset: 'warm', focus: 'top', title: 'Заголовок', subtitles: [{ start: 0, end: 1, text: 'Привет' }], note: 'Сделал' });
  });

  it('replaces junk with safe values', () => {
    const plan = sanitizePlan({ preset: 'neon', focus: 'left', subtitles: [{ start: -1, end: 2, text: 'a' }, { start: 2, end: 1, text: 'b' }, { start: 0, end: 1, text: '' }, 7] });
    assert.equal(plan.preset, 'clean');
    assert.equal(plan.focus, 'center');
    assert.equal(plan.title, '');
    assert.deepEqual(plan.subtitles, []);
    assert.equal(plan.note, 'Подогнал под формат публикации');
    assert.equal(sanitizePlan(undefined).preset, 'clean');
  });

  it('makes the default plan from the segments', () => {
    const plan = defaultPlan([{ start: 0, end: 2, text: 'Привет' }]);
    assert.equal(plan.preset, 'clean');
    assert.equal(plan.subtitles.length, 1);
  });
});

describe('talking to the server', () => {
  let server;
  let config;
  let calls;
  let nextCount;

  before(async () => {
    calls = [];
    nextCount = 0;
    server = createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        calls.push({ method: request.method, url: request.url, type: request.headers['content-type'], body: Buffer.concat(chunks) });
        if (request.url === '/api/agent/media/next') {
          nextCount += 1;
          if (nextCount === 1) {
            response.writeHead(204);
            response.end();
            return;
          }
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ id: 'm1', key: 'w1-mon', unit: '', kind: 'video', format: 'reels', sourceType: 'video/quicktime', sourceName: 'a.mov', sourceSize: 3 }));
          return;
        }
        if (request.url === '/api/agent/media/m1/source') {
          response.writeHead(200, { 'Content-Type': 'video/quicktime' });
          response.end(Buffer.from([1, 2, 3]));
          return;
        }
        if (request.url === '/api/agent/media/gone/source') {
          response.writeHead(404, { 'Content-Type': 'application/json' });
          response.end('{"error":"нет"}');
          return;
        }
        if (request.url === '/api/agent/media/m1/plan') {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ preset: 'warm', focus: 'center', title: '', subtitles: [], note: 'ok', source: 'zai' }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    config = { server: `http://127.0.0.1:${server.address().port}` };
  });

  after(() => server.close());

  it('gets nothing from an empty queue and the item when there is one', async () => {
    assert.equal(await nextMedia(config), undefined);
    const item = await nextMedia(config);
    assert.equal(item.id, 'm1');
    assert.equal(item.sourceType, 'video/quicktime');
  });

  it('downloads the source into a file and reports a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-media-test-'));
    try {
      const target = join(dir, 'source.mov');
      await downloadSource(config, 'm1', target);
      assert.deepEqual([...readFileSync(target)], [1, 2, 3]);
      await assert.rejects(() => downloadSource(config, 'gone', join(dir, 'x.mov')), (error) => error.code === 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks for a plan with data and a preview', async () => {
    const plan = await requestPlan(config, 'm1', { width: 1920, height: 1080, durationMs: 14800, segments: [{ start: 0, end: 2.4, text: 'привет' }] }, Buffer.from([255, 216, 255]));
    const call = calls.at(-1);
    const text = call.body.toString('latin1');
    assert.equal(plan.preset, 'warm');
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/api/agent/media/m1/plan');
    assert.match(call.type, /^multipart\/form-data/);
    assert.ok(text.includes('name="data"'));
    assert.ok(text.includes('name="preview"'));
    assert.ok(text.includes('image/jpeg'));
    assert.ok(call.body.includes(Buffer.from('"durationMs":14800')));
  });

  it('asks for a plan without a preview', async () => {
    await requestPlan(config, 'm1', { width: 1, height: 1, durationMs: 0, segments: [] });
    assert.ok(!calls.at(-1).body.toString('latin1').includes('name="preview"'));
  });

  it('sends the result with data, file and thumb', async () => {
    await submitResult(
      config,
      'm1',
      { width: 1080, height: 1920, durationMs: 14800, subtitled: true, note: 'Готово' },
      { data: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]), mediaType: 'video/mp4', name: 'result.mp4' },
      Buffer.from([255, 216]),
    );
    const call = calls.at(-1);
    const text = call.body.toString('latin1');
    assert.equal(call.url, '/api/agent/media/m1/result');
    assert.match(call.type, /^multipart\/form-data/);
    assert.ok(text.includes('name="data"'));
    assert.ok(text.includes('name="file"; filename="result.mp4"'));
    assert.ok(text.includes('video/mp4'));
    assert.ok(text.includes('name="thumb"'));
    assert.ok(call.body.includes(Buffer.from('"subtitled":true')));
  });

  it('reports a failure', async () => {
    await failMedia(config, 'm1', 'нет кодека', true);
    const call = calls.at(-1);
    assert.equal(call.url, '/api/agent/media/m1/fail');
    assert.deepEqual(JSON.parse(call.body.toString()), { reason: 'нет кодека', final: true });
  });

  it('knows an unreachable server', async () => {
    await assert.rejects(() => nextMedia({ server: 'http://127.0.0.1:1' }), (error) => error.code === 4);
  });
});
