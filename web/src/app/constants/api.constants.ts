export const API_DEV_URL = 'http://localhost:8080';

export const API_PRODUCTION_URL = 'https://interceptor.tail969ed0.ts.net';

export const API_CHAT_PATH = '/api/chat';

export const API_STRATEGY_PATH = '/api/strategy';

export const API_KIT_PATH = '/api/kit';

export const API_ME_PATH = '/api/me';

export const API_ME_NAME_PATH = '/api/me/name';

export const API_ME_YANDEX_PATH = '/api/me/yandex';

export const API_AUTH_CONFIG_PATH = '/api/auth/config';

export const API_AUTH_YANDEX_PATH = '/api/auth/yandex';

export const API_STATE_PATH = '/api/state';

export const API_REVIEW_PATH = '/api/review';

export const API_CLIENT_ERROR_PATH = '/api/client-error';

export const CONVERSATION_STORAGE_KEY = 'helper.conversation-id';

export const HTTP_UNAUTHORIZED = 401;

export const HTTP_OFFLINE = 0;

export const HTTP_UNPROCESSABLE = 422;

export const HTTP_CONFLICT = 409;

export const ACCESS_PASSWORD_STORAGE_KEY = 'helper.access-password';

export const API_MESSAGES = {
  notConfigured: 'Адрес сервера помощника не задан',
  unauthorized: 'Неверный код доступа. Введите его заново',
  offline: 'Нет связи с сервером. Проверьте интернет и повторите',
  failed: 'Помощник сейчас недоступен. Попробуйте ещё раз',
} as const;

export const API_PUSH_KEY_PATH = '/api/push/key';

export const API_PUSH_SUBSCRIBE_PATH = '/api/push/subscribe';

export const API_PUSH_UNSUBSCRIBE_PATH = '/api/push/unsubscribe';
