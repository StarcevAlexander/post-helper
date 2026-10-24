import { PostFormat } from '../models';

export const KITS_STORAGE_KEY = 'helper.kits';

export const KIT_FRAME_LABELS: Record<PostFormat, string> = {
  reels: 'Сцена',
  post: 'Слайд',
  stories: 'Кадр',
};

export const KIT_CLOSE_LABEL = 'Закрыть комплект';

export const KIT_TITLE = 'Комплект публикации';

export const KIT_SECTIONS = {
  frames: 'По порядку показа',
  caption: 'Подпись',
  hashtags: 'Хэштеги',
  tip: 'Подсказка',
} as const;

export const KIT_OVERLAY_LABEL = 'Текст на экране';

export const KIT_VISUAL_LABEL = 'В кадре';

export const KIT_COPY_CAPTION_LABEL = 'Скопировать подпись и хэштеги';

export const KIT_COPIED_LABEL = 'Скопировано';

export const KIT_COPY_FAILED_LABEL = 'Не удалось скопировать';

export const KIT_OPEN_LABEL = 'Открыть комплект';

export const KIT_PENDING_LABEL = 'Комплект скоро появится';

export const KIT_MISSING_TEXT = 'Комплект не найден: возможно, календарь был составлен заново.';

export const KIT_COPY_FEEDBACK_MS = 2000;

export const CLIPBOARD_TIMEOUT_MS = 1500;
