import { APP_LINK_PARAM, TODAY_LINK_VALUE } from '../constants';

export function todayLink(base: string): string {
  const url = new URL('./', base);
  url.searchParams.set(APP_LINK_PARAM, TODAY_LINK_VALUE);
  return url.href;
}

export function isTodayLink(search: string): boolean {
  return new URLSearchParams(search).get(APP_LINK_PARAM) === TODAY_LINK_VALUE;
}
