import { Service, effect, signal } from '@angular/core';
import {
  BASE_FONT_SIZE_PX,
  DEFAULT_SCALE,
  DEFAULT_THEME,
  MAX_SCALE,
  MIN_SCALE,
  SCALE_STEP,
  SCALE_STORAGE_KEY,
  SPEAK_REPLIES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEMES,
} from '../constants';
import { ThemeId } from '../models';

@Service()
export class Settings {
  readonly speakReplies = signal(this.restoreFlag(SPEAK_REPLIES_STORAGE_KEY));

  readonly theme = signal<ThemeId>(this.restoreTheme());
  readonly scale = signal(this.restoreScale());

  constructor() {
    effect(() => {
      const id = this.theme();
      document.documentElement.dataset['theme'] = id;
      const color = THEMES.find((option) => option.id === id)?.themeColor;
      if (color) {
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
      }
    });

    effect(() => {
      document.documentElement.style.fontSize = `${(BASE_FONT_SIZE_PX * this.scale()) / 100}px`;
    });
  }

  setScale(percent: number): void {
    const clamped = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.round(percent / SCALE_STEP) * SCALE_STEP),
    );
    this.scale.set(clamped);
    try {
      localStorage.setItem(SCALE_STORAGE_KEY, String(clamped));
    } catch {
      return;
    }
  }

  setTheme(id: ThemeId): void {
    this.theme.set(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      return;
    }
  }

  setSpeakReplies(enabled: boolean): void {
    this.speakReplies.set(enabled);
    this.storeFlag(SPEAK_REPLIES_STORAGE_KEY, enabled);
  }

  private storeFlag(key: string, enabled: boolean): void {
    try {
      localStorage.setItem(key, JSON.stringify(enabled));
    } catch {
      return;
    }
  }

  private restoreFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  }

  private restoreTheme(): ThemeId {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      return THEMES.find((option) => option.id === stored)?.id ?? DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  private restoreScale(): number {
    try {
      const stored = Number(localStorage.getItem(SCALE_STORAGE_KEY));
      if (Number.isFinite(stored) && stored >= MIN_SCALE && stored <= MAX_SCALE) {
        return stored;
      }
    } catch {
      return DEFAULT_SCALE;
    }
    return DEFAULT_SCALE;
  }
}
