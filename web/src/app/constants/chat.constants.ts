export const SPEECH_LANG = 'ru-RU';

export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

export const MAX_ATTACHMENTS = 8;

export const CHAT_HISTORY_STORAGE_KEY = 'helper.chat-history';

export const SPEAK_REPLIES_STORAGE_KEY = 'helper.speak-replies';

export const SPEAK_REPLIES_LABEL = 'Озвучивать ответы';

export const SETTINGS_TITLE = 'Настройки';

export const SETTINGS_OPEN_LABEL = 'Открыть настройки';

export const SETTINGS_CLOSE_LABEL = 'Закрыть настройки';

export const MAX_STORED_MESSAGES = 100;

export const MAX_HISTORY_TURNS = 20;

export const HISTORY_CONTEXT_LABEL = 'В беседе учитывается сообщений';

export const CLEAR_CONFIRM_TIMEOUT_MS = 3000;

export const IMAGE_MAX_SIDE_PX = 1600;

export const IMAGE_JPEG_QUALITY = 0.85;

export const IMAGE_KEEP_BELOW_BYTES = 400 * 1024;

export const SENDABLE_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export const ACCEPTED_FILE_TYPES = 'image/*,application/pdf,text/plain,text/markdown,text/csv';

export const WELCOME_TEXT =
  'Я ваш помощник. Напишите, что нужно, и при необходимости приложите файл. Контент-план я готовлю по ссылкам на ваши соцсети: отправьте заявку кнопкой в шапке.';

export const VOICE_INPUT_LABELS = {
  start: 'Голосовой ввод',
  stop: 'Остановить запись',
} as const;

export const UPDATE_BUTTON_LABEL = 'Обновить';

export const DIALOG_CANCEL_LABEL = 'Отмена';

export const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export const UPDATE_APPLY_RETRY_MS = 5000;
