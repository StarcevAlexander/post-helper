const SPLASH_ID = 'splash';
const SPLASH_TEXT_ID = 'splash-text';

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
