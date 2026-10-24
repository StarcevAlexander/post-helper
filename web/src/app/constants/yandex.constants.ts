export const YANDEX_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';

export const OAUTH_STATE_STORAGE_KEY = 'helper.oauth-state';

export const OAUTH_STATE_BYTES = 16;

export const YANDEX_PROVIDER = 'yandex';

export const YANDEX_TEXTS = {
  signIn: 'Войти через Яндекс',
  signInHint: 'Если аккаунта ещё нет, он создастся сам',
  link: 'Привязать Яндекс',
  linked: 'Яндекс привязан, им можно входить с любого телефона',
  linkedDone: 'Яндекс привязан',
  denied: 'Вход через Яндекс отменён',
  failed: 'Не удалось войти через Яндекс. Попробуйте ещё раз',
  working: 'Входим через Яндекс…',
  logoutHint:
    'Ваши данные сохранены на сервере. Чтобы вернуться, понадобится ваш пароль или вход через Яндекс.',
} as const;
