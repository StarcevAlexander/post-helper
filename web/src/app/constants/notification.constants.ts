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

export const PUSH_OFFER_DISMISSED_KEY = 'helper.push-offer-dismissed';

export const PUSH_TEXTS = {
  label: 'Получать пуш-уведомления',
  hint: 'Напоминания о дне съёмки и о каждой публикации, а также весть о готовом плане и референсах',
  offerTitle: 'Включите напоминания',
  offerText:
    'За час до дня съёмки и за 15 минут до публикации придёт уведомление. Без него план легко пропустить.',
  offerEnable: 'Включить',
  offerLater: 'Не сейчас',
  testLabel: 'Проверить уведомление',
  unsupported:
    'Здесь уведомления недоступны. На iPhone добавьте приложение на экран «Домой» и откройте его оттуда',
  denied: 'Разрешение на уведомления не дано. Разрешите их в настройках браузера',
  enabled: 'Уведомления включены',
  disabled: 'Уведомления выключены',
  failed: 'Не удалось изменить уведомления. Попробуйте ещё раз',
} as const;
