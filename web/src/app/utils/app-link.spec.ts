import { isTodayLink } from './app-link';

describe('app links', () => {
  it('recognises the today link in a query string', () => {
    expect(isTodayLink('?screen=today')).toBe(true);
    expect(isTodayLink('?a=1&screen=today')).toBe(true);
    expect(isTodayLink('?screen=plan')).toBe(false);
    expect(isTodayLink('')).toBe(false);
  });
});
