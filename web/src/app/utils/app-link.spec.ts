import { isTodayLink, todayLink } from './app-link';

describe('app links', () => {
  it('builds a link to the today screen next to the app base', () => {
    expect(todayLink('https://example.github.io/post_helper/')).toBe(
      'https://example.github.io/post_helper/?screen=today',
    );
  });

  it('drops a stale query and hash from the base', () => {
    expect(todayLink('https://example.github.io/post_helper/?x=1#y')).toBe(
      'https://example.github.io/post_helper/?screen=today',
    );
  });

  it('recognises the today link in a query string', () => {
    expect(isTodayLink('?screen=today')).toBe(true);
    expect(isTodayLink('?a=1&screen=today')).toBe(true);
    expect(isTodayLink('?screen=plan')).toBe(false);
    expect(isTodayLink('')).toBe(false);
  });
});
