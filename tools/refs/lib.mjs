import { AgentError } from '../agent/lib.mjs';

export const PHOTO = { width: 576, height: 704, steps: 20 };

const UNET_PHOTO = 'qwen-image-2.1-Q8_0.gguf';
const CLIP_PHOTO = 'qwen3vl_8b_int8_convrot.safetensors';
const VAE_PHOTO = 'qwen_image_2.1_vae_bf16.safetensors';

export function photoWorkflow(prompt, seed, prefix) {
  return {
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: UNET_PHOTO } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: CLIP_PHOTO, type: 'qwen_image' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: VAE_PHOTO } },
    4: {
      class_type: 'TextEncodeQwenImage21',
      inputs: { clip: ['2', 0], prompt, negative_prompt: '', resolution: 1024 },
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: { width: PHOTO.width, height: PHOTO.height, batch_size: 1 },
    },
    6: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['4', 1],
        latent_image: ['5', 0],
        seed,
        steps: PHOTO.steps,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    7: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    8: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: prefix } },
  };
}

export const MIN_FREE_VRAM_MB = 9500;

export function parseFreeVram(text) {
  const values = String(text)
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((value) => Number.isFinite(value));
  return values.length === 0 ? undefined : Math.max(...values);
}

export function workflowFor(kind, prompt, seed, prefix) {
  if (kind === 'photo') {
    return photoWorkflow(prompt, seed, prefix);
  }
  throw new AgentError(`Неизвестный тип референса: ${kind}`, 2);
}

export function ffmpegArgs(input, output) {
  return ['-y', '-i', input, '-vf', 'scale=640:-2', '-q:v', '6', output];
}

export const OUTPUT_NAME = 'ref.jpg';

export const MEDIA_TYPE = 'image/jpeg';

async function request(config, method, path, body, headers = {}) {
  let response;
  try {
    response = await fetch(`${config.server}${path}`, {
      method,
      headers,
      body,
    });
  } catch (error) {
    throw new AgentError(`Сервер недоступен (${config.server}): ${error.message}`, 4);
  }
  if (response.status === 204) {
    return undefined;
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new AgentError(`Сервер ответил ${response.status}: ${data?.error ?? text}`, 6);
  }
  return data;
}

export function nextRef(config) {
  return request(config, 'GET', '/api/agent/refs/next');
}

export function submitRefs(config, id, files) {
  const form = new FormData();
  form.append('data', JSON.stringify(files.map((file) => file.caption ?? '')));
  for (const file of files) {
    form.append('files', new Blob([file.data], { type: file.mediaType }), file.name);
  }
  return request(config, 'POST', `/api/agent/refs/${encodeURIComponent(id)}/result`, form);
}

export function failRef(config, id, reason, final) {
  return request(config, 'POST', `/api/agent/refs/${encodeURIComponent(id)}/fail`, JSON.stringify({ reason, final: Boolean(final) }), {
    'Content-Type': 'application/json',
  });
}
