import { MediaFormat, MediaKind } from '../models';

export const API_MEDIA_UPLOAD_PATH = '/api/media/upload';

export const API_MEDIA_STATUS_PATH = '/api/media/status';

export const API_MEDIA_FILES_PATH = '/api/media/files';

export const API_MEDIA_ITEMS_PATH = '/api/media';

export const MEDIA_POLL_MS = 20000;

export const MEDIA_ACCEPT = 'image/*,video/*';

export const MEDIA_MAX_BYTES = 300 * 1024 * 1024;

export const MEDIA_FEEDBACK_MS = 2500;

export const MEDIA_NOTES_STORAGE_KEY = 'helper.media-notes';

export const MEDIA_NOTE_MAX_LENGTH = 1000;

export const MEDIA_COPY_MAX_BYTES = 120 * 1024 * 1024;

export const MEDIA_FILE_EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'image/jpeg': 'jpg',
};

export const MEDIA_KIND_EXTENSIONS: Record<MediaKind, string> = {
  video: 'mp4',
  photo: 'jpg',
};

export const MEDIA_FORMAT_RATIOS: Record<MediaFormat, string> = {
  reels: '9 / 16',
  stories: '9 / 16',
  post: '4 / 5',
};

export const MEDIA_TEXTS = {
  capture: 'Снять',
  captureLabel: 'Снять фото или видео на камеру',
  gallery: 'Из галереи',
  galleryLabel: 'Выбрать фото или видео из галереи',
  uploading: 'Загружаю',
  queued: 'В очереди на обработку',
  running: 'Обрабатываю',
  done: 'Готово',
  failed: 'Не получилось',
  open: 'Открыть',
  remove: 'Удалить',
  dismiss: 'Убрать',
  tooLarge: 'Файл больше 300 МБ. Сократите видео или выберите другой файл.',
  emptyFile: 'Файл пришёл пустым. Откройте приложение заново и выберите его «Из галереи».',
  unreadable: 'Не удалось прочитать файл. Откройте приложение заново и выберите его «Из галереи».',
  uploadFailed: 'Не удалось загрузить файл. Проверьте интернет и попробуйте ещё раз.',
  failedAction: 'Не удалось выполнить действие',
  contentTitle: 'Готовый контент',
  contentLink: 'Готовый контент',
  contentPending: 'Контент обрабатывается',
  contentHint: 'Посмотрите, скачайте и опубликуйте сами. Подпись к публикации ниже.',
  photoAlt: 'Готовое фото',
  videoLabel: 'Готовое видео',
  tileAlt: 'Превью',
  loading: 'Загружаю…',
  loadFailed: 'Не удалось загрузить файл. Нажмите, чтобы повторить',
  save: 'Сохранить в телефон',
  download: 'Скачать',
  saved: 'Файл сохранён',
  saveFailed: 'Не удалось сохранить файл',
  confirmRemove: 'Удалить этот файл насовсем?',
  confirmYes: 'Да, удалить',
  confirmNo: 'Отмена',
  captionTitle: 'Подпись из комплекта',
  salesTitle: 'Текст для публикации',
  noteLabel: 'Что хотите сказать в этой публикации',
  noteHint:
    'Напишите своими словами: о чём публикация, что предлагаете, для кого. Я перепишу это в продающий текст.',
  copyCaption: 'Скопировать текст',
  copied: 'Текст скопирован',
  copyFailed: 'Не удалось скопировать',
  shootMore: 'Снять ещё',
  empty: 'Пока ничего не снято. Откройте список съёмки на неделю и нажмите «Снять» у кадра.',
  openShoot: 'Список съёмки на неделю',
  missing: 'Такой публикации в плане нет.',
} as const;
