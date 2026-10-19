import { ErrorSource } from '../models';

export const ERROR_LOG_STORAGE_KEY = 'helper.error-log';

export const MAX_ERROR_ENTRIES = 50;

export const MAX_ERROR_MESSAGE_LENGTH = 300;

export const COPY_FEEDBACK_MS = 2000;

export const ERROR_LOG_TITLE = 'Журнал ошибок';

export const ERROR_LOG_EMPTY_TEXT = 'Ошибок пока нет';

export const ERROR_LOG_COPY_LABEL = 'Скопировать';

export const ERROR_LOG_COPIED_LABEL = 'Скопировано';

export const ERROR_LOG_COPY_FAILED_LABEL = 'Не удалось скопировать';

export const ERROR_LOG_CLEAR_LABEL = 'Очистить';

export const ERROR_LOG_CLEAR_TITLE = 'Очистить журнал ошибок?';

export const ERROR_LOG_CLEAR_TEXT =
  'Все записи журнала будут удалены без возможности восстановления.';

export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = {
  send: 'Отправка сообщения',
  microphone: 'Микрофон',
  speech: 'Озвучка',
  attachment: 'Прикрепление файла',
};
