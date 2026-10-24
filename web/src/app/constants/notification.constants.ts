export const TEST_NOTIFICATION_DELAY_MS = 5000;

export const NOTICE_HIDE_DELAY_MS = 6000;

export const TEST_NOTIFICATION_TITLE = 'Помощник';

export const TEST_NOTIFICATION_BODY = 'Это тестовое уведомление. Всё работает!';

export const TEST_NOTIFICATION_ICON = 'icons/icon-192x192.png';

export const NOTIFY_SCHEDULED_TEXT = 'Уведомление придёт через 5 секунд';

export const NOTIFY_UNSUPPORTED_TEXT = 'Этот браузер не поддерживает уведомления';

export const NOTIFY_DENIED_TEXT =
  'Разрешение на уведомления не дано. Разрешите их в настройках браузера';

export const NOTIFY_FAILED_TEXT = 'Не удалось показать уведомление';

export const PUSH_TEXTS = {
  label: 'Уведомления',
  hint: 'Сообщим, когда будут готовы план и референсы',
  testLabel: 'Проверить уведомление',
  unsupported:
    'Здесь уведомления недоступны. На iPhone добавьте приложение на экран «Домой» и откройте его оттуда',
  denied: 'Разрешение на уведомления не дано. Разрешите их в настройках браузера',
  enabled: 'Уведомления включены',
  disabled: 'Уведомления выключены',
  failed: 'Не удалось изменить уведомления. Попробуйте ещё раз',
} as const;
