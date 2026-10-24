export const FEEDBACK_CONTACT_STORAGE_KEY = 'helper.feedback-contact';

export const MAX_FEEDBACK_TEXT = 2000;

export const MAX_FEEDBACK_CONTACT = 200;

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
