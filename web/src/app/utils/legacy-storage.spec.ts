import { LEGACY_STORAGE_KEYS, SETTINGS_STORAGE_KEY } from '../constants';
import { forgetLegacyStorage } from './legacy-storage';

describe('forgetLegacyStorage', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('drops the keys of removed features and keeps the rest', () => {
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.setItem(key, 'old');
    }
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{"theme":"dark"}');

    forgetLegacyStorage();

    expect(LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null)).toBe(false);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe('{"theme":"dark"}');
  });
});
