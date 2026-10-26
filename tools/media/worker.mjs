#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentError, loadConfig, parseArgs } from '../agent/lib.mjs';
import { freeVramMb } from '../refs/comfy.mjs';
import {
  DEFAULT_FONT,
  FAIL_REASON,
  SUBS_FILE,
  audioArgs,
  buildAss,
  buildFilterChain,
  defaultPlan,
  downloadSource,
  extensionFor,
  failMedia,
  hasSubtitles,
  nextMedia,
  parseProbe,
  parseSubs,
  parseWhisper,
  photoArgs,
  previewArgs,
  probeArgs,
  requestPlan,
  runTool,
  sanitizePlan,
  sizeFor,
  submitResult,
  thumbArgs,
  videoArgs,
  whisperArgs,
  whisperPlan,
} from './lib.mjs';

const HELP = `Воркер обработки фото и видео «Помощника»: забирает снятое мастером, расшифровывает речь,
кадрирует под формат, накладывает цвет, субтитры и заголовок и отдаёт готовый файл серверу.

  node tools/media/worker.mjs [--once] [--interval 60]
  node tools/media/worker.mjs --sample файл [--format reels|post|stories] [--out папка]
                              [--preset clean|warm|cool|soft|bright|none] [--focus top|center|bottom]
                              [--title "Заголовок"] [--subs "0-2:Привет|2-4:Пока"]

  --once      взять один пункт и выйти (код 3, если очередь пуста)
  --sample    проверка без сервера: обработать файл с планом по умолчанию (речь расшифровывается, если есть звук)
  --subs      свои субтитры вместо речи: секунды начала-конца, двоеточие, текст, пункты через |

Настройка: сервер по умолчанию http://127.0.0.1:8081 (AGENT_SERVER в tools/agent/.env переопределяет).
Переменные: WHISPER_MODEL (по умолчанию large-v3-turbo), MEDIA_FONT (по умолчанию ${DEFAULT_FONT}).
Нужны ffmpeg, ffprobe и whisper в PATH.`;

const here = dirname(fileURLToPath(import.meta.url));
const log = (text) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${text}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const seconds = (since) => Math.round((Date.now() - since) / 100) / 10;

function ffmpeg(args, cwd) {
  const result = runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { cwd });
  if (!result.ok) {
    throw new AgentError(`ffmpeg: ${result.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`, 5);
  }
}

function probe(path) {
  const result = runTool('ffprobe', probeArgs(path));
  if (!result.ok) {
    throw new AgentError(`ffprobe не прочитал файл: ${result.stderr.trim().split(/\r?\n/).slice(-1)[0]}`, 5);
  }
  return parseProbe(result.stdout);
}

function transcribe(dir, audio) {
  const plan = whisperPlan(freeVramMb(), process.env);
  log(`  whisper: модель ${plan.model}, ${plan.device === 'cuda' ? 'видеокарта' : 'процессор'}`);
  const args = whisperArgs(audio, dir, plan);
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  let result;
  try {
    result = runTool('whisper', args, { cwd: dir, env });
  } catch {
    result = runTool('python', ['-m', 'whisper', ...args], { cwd: dir, env });
  }
  const output = join(dir, `${basename(audio, '.wav')}.json`);
  if (!result.ok || !existsSync(output)) {
    throw new AgentError(`whisper не отработал: ${result.stderr.trim().split(/\r?\n/).slice(-1)[0] ?? ''}`, 5);
  }
  return parseWhisper(readFileSync(output, 'utf8'));
}

function analyze(dir, source, kind) {
  const info = probe(source);
  const preview = join(dir, 'preview.jpg');
  ffmpeg(previewArgs(kind, source, preview, info.durationMs), dir);
  let segments = [];
  if (kind === 'video' && info.hasAudio) {
    try {
      const audio = join(dir, 'audio.wav');
      ffmpeg(audioArgs(source, audio), dir);
      const started = Date.now();
      segments = transcribe(dir, audio);
      log(`  речь: ${segments.length} фраз за ${seconds(started)} с`);
    } catch (error) {
      log(`  предупреждение: речь не расшифрована (${error.message})`);
    }
  }
  return { info, segments, preview: readFileSync(preview) };
}

function render(dir, source, kind, format, info, plan) {
  const size = sizeFor(format);
  const withAss = Boolean(plan.title) || hasSubtitles(plan.subtitles);
  if (withAss) {
    writeFileSync(
      join(dir, SUBS_FILE),
      buildAss({
        title: plan.title,
        subtitles: plan.subtitles,
        width: size.width,
        height: size.height,
        durationMs: kind === 'video' ? info.durationMs : 0,
        font: process.env.MEDIA_FONT ?? DEFAULT_FONT,
      }),
    );
  }
  const filters = buildFilterChain({ format, focus: plan.focus, preset: plan.preset, withAss });
  const output = kind === 'video' ? 'result.mp4' : 'result.jpg';
  let encoder = 'photo';
  if (kind === 'video') {
    encoder = 'nvenc';
    try {
      ffmpeg(videoArgs({ input: source, output, filters, encoder, hasAudio: info.hasAudio }), dir);
    } catch (error) {
      log(`  NVENC не сработал (${error.message}), перекодирую через libx264`);
      encoder = 'x264';
      ffmpeg(videoArgs({ input: source, output, filters, encoder, hasAudio: info.hasAudio }), dir);
    }
  } else {
    ffmpeg(photoArgs({ input: source, output, filters }), dir);
  }
  ffmpeg(thumbArgs(kind, output, 'thumb.jpg'), dir);
  const done = probe(join(dir, output));
  return {
    encoder,
    output: join(dir, output),
    thumb: join(dir, 'thumb.jpg'),
    mediaType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    meta: {
      width: done.width,
      height: done.height,
      durationMs: kind === 'video' ? done.durationMs : 0,
      subtitled: kind === 'video' && hasSubtitles(plan.subtitles),
      note: plan.note,
    },
  };
}

async function processItem(config, item) {
  const dir = mkdtempSync(join(tmpdir(), `ph-media-${item.id}-`));
  let final = false;
  try {
    log(`${item.key}${item.unit ? ` (${item.unit})` : ''}: ${item.kind}, ${item.format}, ${Math.round(item.sourceSize / 1024 / 1024)} МБ`);
    const source = join(dir, `source.${extensionFor(item.sourceType, item.sourceName)}`);
    const started = Date.now();
    await downloadSource(config, item.id, source);
    log(`  скачано за ${seconds(started)} с`);
    let analysis;
    try {
      analysis = analyze(dir, source, item.kind);
    } catch (error) {
      final = true;
      throw error;
    }
    const { info, segments, preview } = analysis;
    const serverPlan = await requestPlan(
      config,
      item.id,
      { width: info.width, height: info.height, durationMs: item.kind === 'video' ? info.durationMs : 0, segments },
      preview,
    ).then(sanitizePlan, (error) => {
      log(`  план от сервера не получен (${error.message}), беру по умолчанию`);
      return defaultPlan(segments);
    });
    log(`  план: ${serverPlan.preset}, ${serverPlan.focus}, заголовок «${serverPlan.title}», субтитров ${serverPlan.subtitles.length}`);
    const rendered = render(dir, source, item.kind, item.format, info, serverPlan);
    log(`  готово за ${seconds(started)} с, ${rendered.meta.width}x${rendered.meta.height}, кодировщик ${rendered.encoder}`);
    await submitResult(
      config,
      item.id,
      rendered.meta,
      { data: readFileSync(rendered.output), mediaType: rendered.mediaType, name: basename(rendered.output) },
      readFileSync(rendered.thumb),
    );
    log(`${item.key}: отправлено на сервер`);
  } catch (error) {
    log(`ошибка: ${error.message}`);
    await failMedia(config, item.id, FAIL_REASON, final).catch(() => undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runSample(flags) {
  const input = resolve(String(flags.sample));
  if (!existsSync(input)) {
    throw new AgentError(`Файл не найден: ${input}`, 2);
  }
  const outDir = resolve(String(flags.out ?? '.'));
  mkdirSync(outDir, { recursive: true });
  const format = String(flags.format ?? 'reels');
  const dir = mkdtempSync(join(tmpdir(), 'ph-media-sample-'));
  try {
    const source = join(dir, `source.${extensionFor('', input)}`);
    copyFileSync(input, source);
    const kind = /\.(mp4|mov|webm|3gp|m4v|mkv)$/i.test(input) ? 'video' : 'photo';
    const started = Date.now();
    const { info, segments } = analyze(dir, source, kind);
    const subtitles = flags.subs ? parseSubs(String(flags.subs)) : segments;
    const plan = sanitizePlan({
      ...defaultPlan(subtitles),
      preset: flags.preset ?? 'clean',
      focus: flags.focus ?? 'center',
      title: flags.title === true ? '' : (flags.title ?? ''),
      subtitles,
    });
    log(`вход: ${info.width}x${info.height}, ${info.durationMs} мс, звук ${info.hasAudio ? 'есть' : 'нет'}, тип ${kind}`);
    const rendered = render(dir, source, kind, format, info, plan);
    const target = join(outDir, `sample-${format}.${kind === 'video' ? 'mp4' : 'jpg'}`);
    copyFileSync(rendered.output, target);
    copyFileSync(rendered.thumb, join(outDir, `sample-${format}-thumb.jpg`));
    log(`результат: ${rendered.meta.width}x${rendered.meta.height}, ${rendered.meta.durationMs} мс, субтитры ${rendered.meta.subtitled ? 'да' : 'нет'}, кодировщик ${rendered.encoder}, за ${seconds(started)} с -> ${target}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  const { flags } = parseArgs(argv);
  if (flags.help) {
    console.log(HELP);
    return 0;
  }
  process.on('SIGINT', () => process.exit(0));
  if (flags.sample) {
    runSample(flags);
    return 0;
  }
  const config = loadConfig(process.env, join(here, '..', 'agent', '.env'));
  const interval = (flags.interval ? Number(flags.interval) : 60) * 1000;
  log(`слежу за очередью обработки ${config.server}`);
  for (;;) {
    let item;
    try {
      item = await nextMedia(config);
    } catch (error) {
      log(`очередь недоступна: ${error.message}`);
    }
    if (item) {
      await processItem(config, item);
      if (flags.once) {
        return 0;
      }
      continue;
    }
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
