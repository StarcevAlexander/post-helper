export const API_REFS_ORDER_PATH = '/api/refs/order';

export const API_REFS_STATUS_PATH = '/api/refs/status';

export const API_REFS_MADE_PATH = '/api/refs/made';

export const API_REFS_FILES_PATH = '/api/refs/files';

export const REFS_POLL_MS = 25000;

export const REFS_ORDER_DELAY_MS = 1500;

export const REFS_TEXTS = {
  open: 'Референсы',
  waiting: 'Референсы в очереди',
  making: 'Референсы делаются',
  failed: 'Референсы не получились',
  made: 'Контент изготовлен',
  title: 'Референсы к публикации',
  closeLabel: 'Закрыть референсы',
  intro:
    'Это примеры того, как может выглядеть кадр. Качество у картинок невысокое: смотрите на композицию и свет, читайте описание и снимите свою версию.',
  photo: 'Фото',
  descriptionTitle: 'Описание кадра',
  pending: 'Референсы ещё готовятся. Откройте приложение позже, они появятся сами.',
  loading: 'Загружаю…',
  loadFailed: 'Не удалось загрузить файл',
  done: 'Контент изготовлен',
  doneHint: 'После подтверждения референсы удалятся с сервера.',
  confirmTitle: 'Контент изготовлен?',
  confirmText: 'Референсы к этой публикации будут удалены, вернуть их не получится.',
  ok: 'ОК',
  cancel: 'Отмена',
  failedAction: 'Не удалось выполнить действие',
  blocked:
    'Новые референсы пока не делаются: нажмите «Контент изготовлен» у прошедших публикаций, и я подготовлю следующие.',
  stale: 'Подтвердите, что контент изготовлен',
} as const;
