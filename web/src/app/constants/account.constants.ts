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

export const ADMIN_MASTERS_TITLE = 'Мастера и расходы';

export const ADMIN_TEXTS = {
  create: 'Добавить мастера',
  namePlaceholder: 'Имя мастера',
  nameLabel: 'Имя нового мастера',
  codeTitle: 'Код доступа создан',
  codeHint:
    'Покажите его мастеру. Код виден только сейчас: потом его не узнать, можно только создать новый.',
  copy: 'Скопировать код',
  copied: 'Скопировано',
  copyFailed: 'Не удалось скопировать',
  empty: 'Мастеров пока нет',
  disable: 'Отключить',
  enable: 'Включить',
  disabled: 'отключён',
  lastSeen: 'был',
  never: 'ещё не входил',
  today: 'сегодня',
  total: 'всего',
  requests: 'обращений',
  failed: 'Не удалось выполнить действие',
  loadFailed: 'Не удалось загрузить список мастеров',
} as const;

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

export const ADMIN_JOURNAL_TEXTS = {
  journal: 'Журнал',
  hideJournal: 'Свернуть журнал',
  export: 'Выгрузить',
  delete: 'Удалить',
  deleteConfirm: 'Точно удалить всё?',
  deleteDone: 'Мастер и все его данные удалены',
  title: 'Журнал мастера',
  events: 'Действия и ответы ИИ',
  versions: 'Версии данных',
  noEvents: 'Записей пока нет',
  noVersions: 'Версий пока нет',
  restore: 'Вернуть',
  restoreConfirm: 'Точно вернуть?',
  restored: 'Версия возвращена: мастер получит её при следующем входе в приложение',
  retention: 'Журнал и история хранятся',
  days: 'дн.',
  forever: 'бессрочно',
  loadFailed: 'Не удалось загрузить журнал',
} as const;

export const EVENT_LABELS: Record<string, string> = {
  chat: 'Вопрос в чате',
  strategy: 'Составлена стратегия',
  kit: 'Комплект публикации',
  review: 'Итоги недели',
  audit: 'Разбор Instagram',
  'admin.restore': 'Возврат версии (владелец)',
};

export const EVENTS_LIMIT = 100;

export const VERSIONS_LIMIT = 50;

export const MAX_EVENT_SUMMARY_RUNES = 120;

export const RETENTION_NOTE_FOR_MASTER = 'История ваших действий и ответов ИИ хранится';

export const EXPORT_FILE_PREFIX = 'master-export';
