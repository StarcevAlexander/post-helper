import { APP_LINK_PARAM, TODAY_LINK_VALUE } from '../constants';

export function isTodayLink(search: string): boolean {
  return new URLSearchParams(search).get(APP_LINK_PARAM) === TODAY_LINK_VALUE;
}
