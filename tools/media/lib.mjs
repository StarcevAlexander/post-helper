import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AgentError } from '../agent/lib.mjs';

export const SIZES = {
  reels: { width: 1080, height: 1920 },
  stories: { width: 1080, height: 1920 },
  post: { width: 1080, height: 1350 },
};

export const PRESETS = {
  clean: 'eq=contrast=1.06:saturation=1.08,unsharp=5:5:0.4',
  warm: 'eq=contrast=1.06:saturation=1.08,unsharp=5:5:0.4,colorbalance=rs=0.04:gs=0.01:bs=-0.04',
  cool: 'eq=contrast=1.06:saturation=1.08,unsharp=5:5:0.4,colorbalance=rs=-0.03:bs=0.05',
  soft: 'eq=contrast=0.96:brightness=0.02:saturation=1.02',
  bright: 'eq=brightness=0.06:contrast=1.04:saturation=1.05,unsharp=5:5:0.3',
  none: '',
};

export const FOCUS_Y = {
  top: '0',
  center: '(ih-oh)/2',
  bottom: 'ih-oh',
};

export const SOURCE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'video/x-m4v': 'm4v',
};

export const MIN_FREE_VRAM_FOR_GPU_MB = 4000;
export const DEFAULT_WHISPER_MODEL = 'large-v3-turbo';
export const CPU_WHISPER_MODEL = 'small';
export const DEFAULT_FONT = 'Arial';
export const TITLE_SECONDS = 4;
export const PHOTO_ASS_SECONDS = 36000;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_NOTE = 'Подогнал под формат публикации';
export const FAIL_REASON = 'Не удалось обработать на ПК';
export const SUBS_FILE = 'subs.ass';

export function sizeFor(format) {
  const size = SIZES[format];
  if (!size) {
    throw new AgentError(`Неизвестный формат публикации: ${format}`, 2);
  }
  return size;
}

export function extensionFor(sourceType, sourceName = '') {
  const known = SOURCE_EXTENSIONS[String(sourceType).toLowerCase()];
  if (known) {
    return known;
  }
  const match = /\.([a-z0-9]{2,5})$/i.exec(sourceName);
  return match ? match[1].toLowerCase() : 'bin';
}

export function rotationOf(stream) {
  const fromSide = (stream.side_data_list ?? []).find((entry) => entry.rotation !== undefined);
  const raw = fromSide ? fromSide.rotation : stream.tags?.rotate;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((Math.round(value) % 360) + 360) % 360;
}

export function parseProbe(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AgentError('ffprobe вернул не JSON', 5);
  }
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video' && stream.width && stream.height);
  if (!video) {
    throw new AgentError('В файле нет изображения', 5);
  }
  const turned = [90, 270].includes(rotationOf(video));
  const seconds = Number(data.format?.duration ?? video.duration ?? 0);
  return {
    width: turned ? video.height : video.width,
    height: turned ? video.width : video.height,
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

export function probeArgs(input) {
  return ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input];
}

export function previewSeconds(durationMs) {
  return Math.min(1, Math.max(0, durationMs / 1000) / 2);
}

export function previewArgs(kind, input, output, durationMs = 0) {
  if (kind === 'photo') {
    return ['-y', '-i', input, '-vf', 'scale=640:-2', '-frames:v', '1', '-q:v', '5', output];
  }
  return ['-y', '-ss', String(previewSeconds(durationMs)), '-i', input, '-vf', 'scale=640:-2', '-frames:v', '1', '-q:v', '5', output];
}

export function audioArgs(input, output) {
  return ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', output];
}

export function whisperPlan(freeMb, env = {}) {
  const useGpu = freeMb !== undefined && freeMb >= MIN_FREE_VRAM_FOR_GPU_MB;
  return useGpu
    ? { device: 'cuda', model: env.WHISPER_MODEL ?? DEFAULT_WHISPER_MODEL, extra: [] }
    : { device: 'cpu', model: CPU_WHISPER_MODEL, extra: ['--device', 'cpu', '--fp16', 'False'] };
}

export function whisperArgs(audio, outputDir, plan) {
  return [audio, '--model', plan.model, '--language', 'ru', '--task', 'transcribe', '--output_format', 'json', '--output_dir', outputDir, ...plan.extra];
}

export function parseWhisper(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  return (Array.isArray(data.segments) ? data.segments : [])
    .filter((segment) => !isHallucination(segment))
    .map((segment) => ({
      start: Math.max(0, Number(segment.start)),
      end: Number(segment.end),
      text: String(segment.text ?? '').trim(),
    }))
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start && segment.text);
}

export const NO_SPEECH_LIMIT = 0.6;
export const LOGPROB_LIMIT = -1;
export const COMPRESSION_LIMIT = 2.4;
export const HALLUCINATION_PHRASES = ['продолжение следует', 'субтитры сделал', 'субтитры создавал', 'редактор субтитров', 'спасибо за просмотр', 'подписывайтесь на канал'];

export function isHallucination(segment) {
  const text = String(segment.text ?? '').trim().toLowerCase();
  if (HALLUCINATION_PHRASES.some((phrase) => text.includes(phrase))) {
    return true;
  }
  const noSpeech = Number(segment.no_speech_prob);
  const logprob = Number(segment.avg_logprob);
  const compression = Number(segment.compression_ratio);
  return (Number.isFinite(noSpeech) && noSpeech > NO_SPEECH_LIMIT) || (Number.isFinite(logprob) && logprob < LOGPROB_LIMIT) || (Number.isFinite(compression) && compression > COMPRESSION_LIMIT);
}

export function parseSubs(text) {
  return String(text)
    .split('|')
    .map((part) => /^\s*([\d.]+)\s*-\s*([\d.]+)\s*:(.*)$/.exec(part))
    .filter(Boolean)
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), text: match[3].trim() }))
    .filter((segment) => segment.end > segment.start && segment.text);
}

export function scaleCropFilter(width, height, focus) {
  const y = FOCUS_Y[focus] ?? FOCUS_Y.center;
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)/2:${y}`;
}

export function presetFilter(preset) {
  return PRESETS[preset] ?? PRESETS.clean;
}

export function buildFilterChain({ format, focus, preset, withAss }) {
  const { width, height } = sizeFor(format);
  return [scaleCropFilter(width, height, focus), presetFilter(preset), withAss ? `ass=${SUBS_FILE}` : '']
    .filter(Boolean)
    .join(',');
}

export function assTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  const two = (value) => String(value).padStart(2, '0');
  return `${h}:${two(m)}:${two(s)}.${two(cs)}`;
}

export function escapeAss(text) {
  return String(text)
    .replace(/[{}\\]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\\N');
}

export function buildAss({ title = '', subtitles = [], width, height, durationMs = 0, font = DEFAULT_FONT }) {
  const subSize = Math.round(height * 0.038);
  const titleSize = Math.round(height * 0.05);
  const subMargin = Math.round(height * 0.18);
  const titleMargin = Math.round(height * 0.12);
  const side = Math.round(width * 0.06);
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${font},${subSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,${side},${side},${subMargin},1`,
    `Style: Title,${font},${titleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,8,${side},${side},${titleMargin},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = [];
  const titleText = escapeAss(title);
  if (titleText) {
    const end = durationMs > 0 ? Math.min(TITLE_SECONDS, durationMs / 1000) : PHOTO_ASS_SECONDS;
    lines.push(`Dialogue: 0,${assTime(0)},${assTime(end)},Title,,0,0,0,,${titleText}`);
  }
  for (const segment of subtitles) {
    const text = escapeAss(segment.text);
    if (text && segment.end > segment.start) {
      lines.push(`Dialogue: 0,${assTime(segment.start)},${assTime(segment.end)},Sub,,0,0,0,,${text}`);
    }
  }
  return `${[...head, ...lines].join('\n')}\n`;
}

export function hasSubtitles(subtitles) {
  return subtitles.some((segment) => String(segment.text ?? '').trim() && segment.end > segment.start);
}

export const ENCODERS = {
  nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', '-b:v', '0'],
  x264: ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium'],
};

export function videoArgs({ input, output, filters, encoder, hasAudio }) {
  return [
    '-y',
    '-i',
    input,
    '-vf',
    filters,
    ...ENCODERS[encoder],
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-movflags',
    '+faststart',
    output,
  ];
}

export function photoArgs({ input, output, filters }) {
  return ['-y', '-i', input, '-vf', filters, '-frames:v', '1', '-q:v', '2', output];
}

export function thumbArgs(kind, input, output) {
  const seek = kind === 'video' ? ['-ss', '0.5'] : [];
  return ['-y', ...seek, '-i', input, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', output];
}

export function sanitizePlan(plan) {
  const preset = Object.hasOwn(PRESETS, plan?.preset) ? plan.preset : 'clean';
  const focus = Object.hasOwn(FOCUS_Y, plan?.focus) ? plan.focus : 'center';
  const subtitles = Array.isArray(plan?.subtitles)
    ? plan.subtitles
        .map((segment) => ({ start: Number(segment.start), end: Number(segment.end), text: String(segment.text ?? '').trim() }))
        .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.end > segment.start && segment.text)
    : [];
  return {
    preset,
    focus,
    title: String(plan?.title ?? '').trim(),
    subtitles,
    note: String(plan?.note ?? '').trim() || DEFAULT_NOTE,
  };
}

export function defaultPlan(segments) {
  return sanitizePlan({ preset: 'clean', focus: 'center', title: '', subtitles: segments, note: DEFAULT_NOTE });
}

export function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
  if (result.error) {
    throw new AgentError(`Не запустилась программа ${command}: ${result.error.message}`, 2);
  }
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

async function request(config, method, path, body, headers = {}) {
  let response;
  try {
    response = await fetch(`${config.server}${path}`, { method, headers, body });
  } catch (error) {
    throw new AgentError(`Сервер недоступен (${config.server}): ${error.message}`, 4);
  }
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    throw new AgentError(`Сервер ответил ${response.status}: ${data?.error ?? text}`, 6);
  }
  return data;
}

const itemPath = (id, tail) => `/api/agent/media/${encodeURIComponent(id)}/${tail}`;

export function nextMedia(config) {
  return request(config, 'GET', '/api/agent/media/next');
}

export async function downloadSource(config, id, target) {
  let response;
  try {
    response = await fetch(`${config.server}${itemPath(id, 'source')}`);
  } catch (error) {
    throw new AgentError(`Сервер недоступен (${config.server}): ${error.message}`, 4);
  }
  if (!response.ok || !response.body) {
    throw new AgentError(`Исходник не скачался: сервер ответил ${response.status}`, 6);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

export function requestPlan(config, id, info, preview) {
  const form = new FormData();
  form.append('data', JSON.stringify(info));
  if (preview) {
    form.append('preview', new Blob([preview], { type: 'image/jpeg' }), 'preview.jpg');
  }
  return request(config, 'POST', itemPath(id, 'plan'), form);
}

export function submitResult(config, id, info, file, thumb) {
  const form = new FormData();
  form.append('data', JSON.stringify(info));
  form.append('file', new Blob([file.data], { type: file.mediaType }), file.name);
  if (thumb) {
    form.append('thumb', new Blob([thumb], { type: 'image/jpeg' }), 'thumb.jpg');
  }
  return request(config, 'POST', itemPath(id, 'result'), form);
}

export function failMedia(config, id, reason, final) {
  return request(config, 'POST', itemPath(id, 'fail'), JSON.stringify({ reason, final: Boolean(final) }), {
    'Content-Type': 'application/json',
  });
}
