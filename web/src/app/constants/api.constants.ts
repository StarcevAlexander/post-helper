export const API_DEV_URL = 'http://localhost:8080';

export const API_PRODUCTION_URL = 'https://post-helper-server.onrender.com';

export const API_CHAT_PATH = '/api/chat';

export const API_STRATEGY_PATH = '/api/strategy';

export const API_KIT_PATH = '/api/kit';

export const API_CLIENT_ERROR_PATH = '/api/client-error';

export const CONVERSATION_STORAGE_KEY = 'helper.conversation-id';

export const HTTP_UNAUTHORIZED = 401;

export const HTTP_OFFLINE = 0;

export const HTTP_UNPROCESSABLE = 422;

export const ACCESS_PASSWORD_STORAGE_KEY = 'helper.access-password';

export const API_MESSAGES = {
  notConfigured: 'Адрес сервера помощника не задан',
  unauthorized: 'Неверный пароль. Введите его заново',
  offline: 'Нет связи с сервером. Проверьте интернет и повторите',
  failed: 'Помощник сейчас недоступен. Попробуйте ещё раз',
} as const;
