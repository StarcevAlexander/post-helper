import { AgentError } from '../agent/lib.mjs';

export const PHOTO = { width: 576, height: 704, steps: 20 };
export const VIDEO = { width: 640, height: 384, seconds: 3, fps: 24, steps: 30, cfg: 5 };

const UNET_PHOTO = 'qwen-image-2.1-Q8_0.gguf';
const CLIP_PHOTO = 'qwen3vl_8b_int8_convrot.safetensors';
const VAE_PHOTO = 'qwen_image_2.1_vae_bf16.safetensors';
const UNET_VIDEO = 'wan2.2_ti2v_5B_fp16.safetensors';
const CLIP_VIDEO = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors';
const VAE_VIDEO = 'wan2.2_vae.safetensors';
const NEGATIVE_VIDEO =
  'blurry, low quality, distorted, deformed, jpeg artifacts, watermark, text, static, motionless, flickering, oversaturated, extra limbs';

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

export function videoLength(seconds, fps) {
  const frames = Math.round(seconds * fps);
  return Math.max(5, Math.round((frames - 1) / 4) * 4 + 1);
}

export function videoWorkflow(prompt, seed, prefix) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: UNET_VIDEO, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: CLIP_VIDEO, type: 'wan' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: VAE_VIDEO } },
    4: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE_VIDEO, clip: ['2', 0] } },
    7: {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: ['3', 0],
        width: VIDEO.width,
        height: VIDEO.height,
        length: videoLength(VIDEO.seconds, VIDEO.fps),
        batch_size: 1,
      },
    },
    8: {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
        seed,
        steps: VIDEO.steps,
        cfg: VIDEO.cfg,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    10: { class_type: 'CreateVideo', inputs: { images: ['9', 0], fps: VIDEO.fps } },
    11: {
      class_type: 'SaveVideo',
      inputs: { video: ['10', 0], filename_prefix: prefix, format: 'auto', codec: 'auto' },
    },
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
  if (kind === 'video') {
    return videoWorkflow(prompt, seed, prefix);
  }
  if (kind === 'photo') {
    return photoWorkflow(prompt, seed, prefix);
  }
  throw new AgentError(`Неизвестный тип референса: ${kind}`, 2);
}

export function ffmpegArgs(kind, input, output) {
  if (kind === 'video') {
    return ['-y', '-i', input, '-vf', 'scale=480:-2', '-an', '-c:v', 'libx264', '-crf', '32', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output];
  }
  return ['-y', '-i', input, '-vf', 'scale=640:-2', '-q:v', '6', output];
}

export function outputName(kind) {
  return kind === 'video' ? 'ref.mp4' : 'ref.jpg';
}

export function mediaTypeOf(kind) {
  return kind === 'video' ? 'video/mp4' : 'image/jpeg';
}

async function request(config, method, path, body, headers = {}) {
  let response;
  try {
    response = await fetch(`${config.server}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, ...headers },
      body,
    });
  } catch (error) {
    throw new AgentError(`Сервер недоступен (${config.server}): ${error.message}`, 4);
  }
  if (response.status === 401) {
    throw new AgentError('Токен агента не подошёл, проверьте AGENT_TOKEN', 5);
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
