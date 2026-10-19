import { RequestStatus } from '../models';

export const REQUEST_LOG_STORAGE_KEY = 'helper.request-log';

export const MAX_REQUEST_ENTRIES = 50;

export const MAX_REQUEST_TEXT_LENGTH = 500;

export const REQUEST_LOG_TITLE = 'Журнал запросов';

export const REQUEST_LOG_EMPTY_TEXT = 'Запросов пока нет';

export const REQUEST_LOG_CLEAR_TITLE = 'Очистить журнал запросов?';

export const REQUEST_LOG_SENT_LABEL = 'Отправлено';

export const REQUEST_LOG_RECEIVED_LABEL = 'Ответ';

export const REQUEST_LOG_ERROR_LABEL = 'Ошибка';

export const REQUEST_LOG_NO_RESPONSE_TEXT = 'Ответа пока нет';

export const REQUEST_LOG_INTERRUPTED_TEXT = 'Запрос прерван до получения ответа';

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'ожидание',
  success: 'успешно',
  error: 'ошибка',
};

export const REQUEST_STATUS_SUMMARIES: Record<RequestStatus, string> = {
  pending: 'ожидание ответа',
  success: 'ответ получен',
  error: 'сбой отправки',
};

export const REQUEST_DESCRIPTIONS = {
  chat: 'Вопрос помощнику',
} as const;
