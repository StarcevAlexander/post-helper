import { ThemeId, ThemeOption } from '../models';

export const THEME_STORAGE_KEY = 'helper.theme';

export const DEFAULT_THEME: ThemeId = 'light';

export const SCALE_STORAGE_KEY = 'helper.scale';

export const DEFAULT_SCALE = 100;

export const MIN_SCALE = 80;

export const MAX_SCALE = 150;

export const SCALE_STEP = 5;

export const BASE_FONT_SIZE_PX = 16;

export const APPEARANCE_TITLE = 'Внешний вид';

export const THEME_SECTION_TITLE = 'Тема';

export const SCALE_SECTION_TITLE = 'Масштаб';

export const BACK_LABEL = 'Назад';

export const THEMES: readonly ThemeOption[] = [
  { id: 'light', label: 'Светлая', themeColor: '#dde7ee' },
  { id: 'dark', label: 'Тёмная', themeColor: '#0f141a' },
  { id: 'ocean', label: 'Океан', themeColor: '#cfe6f5' },
  { id: 'forest', label: 'Лес', themeColor: '#d5e8d8' },
  { id: 'purple', label: 'Фиолетовая', themeColor: '#e6dff5' },
  { id: 'sakura', label: 'Сакура', themeColor: '#f8e1ea' },
  { id: 'sunset', label: 'Закат', themeColor: '#fbe5d0' },
  { id: 'contrast', label: 'Контрастная', themeColor: '#000000' },
  { id: 'mint', label: 'Мята', themeColor: '#d3efe9' },
  { id: 'lemon', label: 'Лимон', themeColor: '#f7f0c4' },
  { id: 'coral', label: 'Коралл', themeColor: '#fbdcd6' },
  { id: 'sand', label: 'Песок', themeColor: '#eadfcc' },
  { id: 'midnight', label: 'Полночь', themeColor: '#0a0e24' },
  { id: 'graphite', label: 'Графит', themeColor: '#17181a' },
  { id: 'aurora', label: 'Аврора', themeColor: '#08170f' },
  { id: 'dusk', label: 'Сумерки', themeColor: '#1b1024' },
];
