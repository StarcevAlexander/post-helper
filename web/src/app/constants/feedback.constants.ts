export const FEEDBACK_CONTACT_STORAGE_KEY = 'helper.feedback-contact';

export const MAX_FEEDBACK_TEXT = 2000;

export const MAX_FEEDBACK_CONTACT = 200;

export const IDEA_REQUESTS_STORAGE_KEY = 'helper.idea-requests';

export const MAX_IDEA_REQUEST_TEXT = 1000;

export const IDEA_REQUEST_TEXTS = {
  title: 'Заменить идею',
  open: 'Заменить идею',
  requested: 'Замена запрошена',
  intro:
    'Напишите пару слов, почему эта идея не подходит и о чём хотите рассказать вместо неё. Я получу запрос и заменю публикацию вместе с комплектом, замена появится в календаре сама.',
  textLabel: 'Чем заменить',
  textPlaceholder: 'Например: не хочу снимать лицо, лучше покажу процесс и результат',
  counter: 'знаков',
  submit: 'Отправить запрос',
  sending: 'Отправляем…',
  sentTitle: 'Запрос отправлен',
  sentText:
    'Пока замена не пришла, публикация остаётся в календаре с прежней идеей: её можно перенести или пропустить.',
  pendingText:
    'Запрос на замену этой идеи уже отправлен. Как только замена будет готова, она появится в календаре.',
  backToCalendar: 'К календарю',
  missing: 'Такой публикации в календаре нет.',
  empty: 'Напишите, чем заменить идею',
} as const;

export const FEEDBACK_TEXTS = {
  title: 'Написать нам',
  open: 'Написать нам',
  intro:
    'Расскажите, что случилось или что хотите предложить. Мы видим ваш аккаунт, поэтому писать, кто вы, не нужно.',
  textLabel: 'Ваше сообщение',
  textPlaceholder: 'Например: не приходит напоминание о съёмке',
  counter: 'знаков',
  contactLabel: 'Как с вами связаться',
  contactHint:
    'Необязательно: телефон, Telegram или почта, если хотите получить ответ не только в приложении.',
  contactPlaceholder: '@имя в Telegram, телефон или почта',
  submit: 'Отправить',
  sending: 'Отправляем…',
  sentTitle: 'Спасибо, сообщение отправлено',
  sentText: 'Мы прочитаем его и ответим, если понадобится.',
  again: 'Написать ещё',
  empty: 'Напишите сообщение',
} as const;
