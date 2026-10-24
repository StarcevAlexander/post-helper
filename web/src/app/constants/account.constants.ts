export const SYNC_META_STORAGE_KEY = 'helper.sync';

export const SYNC_BACKUP_STORAGE_KEY = 'helper.sync-backup';

export const SYNC_PUSH_DELAY_MS = 2000;

export const SYNC_STATUS_TEXT = {
  off: '',
  idle: 'Данные ещё не сохранены на сервере',
  syncing: 'Сохраняю данные на сервере…',
  ok: 'Данные сохранены на сервере, их можно открыть с другого телефона',
  error: 'Не удалось сохранить данные на сервере, попробую позже',
} as const;

export const ACCOUNT_LABELS = {
  signedInAs: 'Вы вошли как',
  of: 'из',
} as const;

export const ACCOUNT_TEXTS = {
  rename: 'Изменить имя',
  nameLabel: 'Ваше имя',
  save: 'Сохранить',
  emptyName: 'Введите имя',
  nameTooLong: 'Имя слишком длинное',
  renameFailed: 'Не удалось сменить имя. Попробуйте ещё раз',
  logout: 'Выйти',
  logoutConfirm: 'Точно выйти?',
  logoutHint: 'Чтобы вернуться, войдите через Яндекс.',
  logoutUnsaved: 'Не удалось сохранить данные на сервере, поэтому выход отменён. Проверьте связь',
  rejected: 'Доступ отключён',
} as const;

export const MAX_NAME_LENGTH = 60;

export const STORAGE_PREFIX = 'helper.';

export const RETENTION_NOTE_FOR_MASTER = 'Ваши данные хранятся';
