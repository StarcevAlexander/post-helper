import { LEGACY_STORAGE_KEYS } from '../constants';

export function forgetLegacyStorage(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      return;
    }
  }
}
