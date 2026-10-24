export type ThemeId =
  | 'light'
  | 'dark'
  | 'ocean'
  | 'forest'
  | 'purple'
  | 'sakura'
  | 'sunset'
  | 'contrast'
  | 'mint'
  | 'lemon'
  | 'coral'
  | 'sand'
  | 'midnight'
  | 'graphite'
  | 'aurora'
  | 'dusk';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  themeColor: string;
}

export type SettingsScreen = 'main' | 'appearance' | 'theme' | 'scale' | 'name';

export interface StoredSettings {
  theme: ThemeId;
  scale: number;
  tutorialSeen?: boolean;
}
