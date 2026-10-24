export const REVIEWS_STORAGE_KEY = 'helper.reviews';

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
  usageToday: 'Обращений к ИИ сегодня',
  of: 'из',
  owner: 'владелец',
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
  logoutHint: 'Ваши данные сохранены на сервере. Чтобы вернуться, понадобится ваш пароль.',
  logoutUnsaved: 'Не удалось сохранить данные на сервере, поэтому выход отменён. Проверьте связь',
  rejected: 'Пароль не подошёл или доступ отключён',
} as const;

export const MAX_NAME_LENGTH = 60;

export const STORAGE_PREFIX = 'helper.';

export const REVIEW_TEXTS = {
  title: 'Итоги недели',
  closeLabel: 'Закрыть итоги',
  hint: 'Ответьте на три вопроса. Если чего-то не знаете, оставьте поле пустым.',
  inquiries: 'Сколько обращений из Instagram пришло за неделю (записи и сообщения)',
  bestIdea: 'Какая публикация сработала лучше всего',
  bestIdeaNone: 'Не знаю',
  hard: 'Что было трудно',
  hardPlaceholder: 'Например: не хватило времени на съёмку',
  submit: 'Подвести итоги',
  submitAgain: 'Подвести итоги заново',
  working: 'Подвожу итоги…',
  numberError: 'Введите число, например 5',
  whatWorked: 'Что получилось',
  whatToChange: 'Что поменять',
  nextFocus: 'Главное на следующей неделе',
  cadence: 'Ритм на неделю',
  newIdeas: 'Новые идеи',
  apply: 'Применить к календарю',
  applied: 'Применено: календарь составлен заново',
  applyHint:
    'Календарь будет составлен заново с новым ритмом и идеями, отметки «Опубликовано» сбросятся.',
  open: 'Подвести итоги недели',
  view: 'Итоги недели',
  notStarted: 'Неделя ещё не началась',
  failed: 'Не удалось подвести итоги',
} as const;

export const REVIEW_BEST_PREFIX = 'Лучше всего сработало';

export const MAX_INQUIRIES = 100000;

export const MAX_IDEAS_PER_PILLAR = 12;

export const RETENTION_NOTE_FOR_MASTER = 'История ваших действий и ответов ИИ хранится';
