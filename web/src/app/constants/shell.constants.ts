export const SETTINGS_TITLE = 'Настройки';

export const SETTINGS_OPEN_LABEL = 'Открыть настройки';

export const SETTINGS_CLOSE_LABEL = 'Закрыть настройки';

export const CLEAR_CONFIRM_TIMEOUT_MS = 3000;

export const UPDATE_BUTTON_LABEL = 'Обновить';

export const DIALOG_CANCEL_LABEL = 'Отмена';

export const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export const UPDATE_APPLY_RETRY_MS = 5000;

export const UPDATE_VERSION_PATH = '/version.json';

export const UPDATE_LAUNCH_WAIT_MS = 15000;

export const UPDATE_LAUNCH_POLL_MS = 500;

export const UPDATE_ATTEMPTS_KEY = 'helper.update-attempts';

export const UPDATE_MAX_ATTEMPTS = 3;

export const UPDATE_TEXTS = {
  spinner: 'Обновляем приложение',
  spinnerHint: 'Загружается новая версия, это займёт несколько секунд.',
} as const;
