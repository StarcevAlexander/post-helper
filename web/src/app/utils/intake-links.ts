import { INTAKE_PLATFORM_HOSTS } from '../constants';
import { IntakePlatform } from '../models';

export function detectPlatform(raw: string): IntakePlatform | undefined {
  const text = raw.trim();
  if (!text || /\s/.test(text)) {
    return undefined;
  }
  let host: string;
  try {
    host = new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!host.includes('.')) {
    return undefined;
  }
  const known = Object.keys(INTAKE_PLATFORM_HOSTS).find(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
  return known ? INTAKE_PLATFORM_HOSTS[known] : 'other';
}
