import { SPLASH_ID, SPLASH_TEXT_ID } from '../constants';

export function showSplash(text: string): void {
  const splash = document.getElementById(SPLASH_ID);
  const label = document.getElementById(SPLASH_TEXT_ID);
  if (label) {
    label.textContent = text;
  }
  splash?.removeAttribute('hidden');
}

export function hideSplash(): void {
  document.getElementById(SPLASH_ID)?.setAttribute('hidden', '');
}
