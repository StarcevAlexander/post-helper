import { Service, effect, signal } from '@angular/core';
import {
  BASE_FONT_SIZE_PX,
  DEFAULT_SCALE,
  DEFAULT_THEME,
  MAX_SCALE,
  MIN_SCALE,
  SCALE_STEP,
  SCALE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEMES,
} from '../constants';
import { StoredSettings, ThemeId } from '../models';

function themeOf(value: unknown): ThemeId | undefined {
  return THEMES.find((option) => option.id === value)?.id;
}

function scaleOf(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_SCALE &&
    value <= MAX_SCALE
    ? value
    : undefined;
}

@Service()
export class Settings {
  private readonly stored = this.restore();

  readonly theme = signal<ThemeId>(this.stored.theme ?? DEFAULT_THEME);
  readonly scale = signal(this.stored.scale ?? DEFAULT_SCALE);

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
    this.save();
  }

  setTheme(id: ThemeId): void {
    this.theme.set(id);
    this.save();
  }

  private save(): void {
    const settings: StoredSettings = { theme: this.theme(), scale: this.scale() };
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      return;
    }
  }

  private restore(): Partial<StoredSettings> {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (typeof parsed === 'object' && parsed !== null) {
        const candidate = parsed as Record<string, unknown>;
        return { theme: themeOf(candidate['theme']), scale: scaleOf(candidate['scale']) };
      }
      return {
        theme: themeOf(localStorage.getItem(THEME_STORAGE_KEY)),
        scale: scaleOf(Number(localStorage.getItem(SCALE_STORAGE_KEY))),
      };
    } catch {
      return {};
    }
  }
}
