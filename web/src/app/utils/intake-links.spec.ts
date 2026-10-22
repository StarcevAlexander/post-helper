import { detectPlatform } from './intake-links';

describe('detectPlatform', () => {
  it('recognises popular networks by link', () => {
    expect(detectPlatform('instagram.com/anna_nails')).toBe('instagram');
    expect(detectPlatform('https://m.vk.com/anna')).toBe('vk');
    expect(detectPlatform('t.me/anna')).toBe('telegram');
    expect(detectPlatform('https://youtube.com/@anna')).toBe('youtube');
    expect(detectPlatform('https://dzen.ru/anna')).toBe('dzen');
  });

  it('calls an unknown site "other"', () => {
    expect(detectPlatform('https://anna-nails.ru')).toBe('other');
  });

  it('gives nothing for text that is not a link', () => {
    expect(detectPlatform('')).toBeUndefined();
    expect(detectPlatform('анна')).toBeUndefined();
    expect(detectPlatform('anna nails')).toBeUndefined();
  });
});
