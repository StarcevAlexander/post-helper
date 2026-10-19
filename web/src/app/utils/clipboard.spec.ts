import { CLIPBOARD_TIMEOUT_MS } from '../constants';
import { copyText } from './clipboard';

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the clipboard API when it works', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    expect(await copyText('текст')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('текст');
  });

  it('falls back to selection copy when the clipboard API rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    document.execCommand = vi.fn(() => true);

    expect(await copyText('текст')).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back when the clipboard API never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => new Promise<void>(() => undefined) },
    });
    document.execCommand = vi.fn(() => true);

    const result = copyText('текст');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_TIMEOUT_MS + 10);

    expect(await result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports a failure when nothing works', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn(() => false);

    expect(await copyText('текст')).toBe(false);
  });

  it('removes its helper field from the page', async () => {
    vi.stubGlobal('navigator', {});
    document.execCommand = vi.fn(() => true);

    await copyText('текст');

    expect(document.querySelector('textarea')).toBeNull();
  });
});
