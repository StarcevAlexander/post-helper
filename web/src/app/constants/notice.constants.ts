import { NoticeReason } from '../models';

export const API_NOTICES_PATH = '/api/notifications';

export const NOTICE_TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const NOTICE_TEXTS = {
  title: 'История уведомлений',
  intro:
    'Здесь уведомления за последние 60 дней. «Подробнее» откроет то, о чём было уведомление, если это ещё актуально',
  empty: 'Уведомлений пока не было',
  loading: 'Загружаю историю…',
  failed: 'Не удалось загрузить историю. Проверьте интернет и попробуйте ещё раз',
  retry: 'Повторить',
  more: 'Подробнее',
  checking: 'Проверяю…',
  checkFailed: 'Не удалось проверить, актуально ли это. Проверьте интернет и попробуйте ещё раз',
  movedTo: 'Публикация перенесена на',
} as const;

export const NOTICE_REASON_TEXTS: Record<Exclude<NoticeReason, 'moved'>, string> = {
  planRemoved: 'Уже не актуально: плана больше нет',
  planReplaced: 'Уже не актуально: с тех пор пришёл новый план',
  refsGone: 'Уже не актуально: референсы к плану убраны',
  mediaGone: 'Уже не актуально: готовый контент удалён или срок его хранения истёк',
  dayPassed: 'Уже не актуально: этот день съёмки прошёл',
  scheduleChanged: 'Уже не актуально: дни съёмки с тех пор изменились',
  itemRemoved: 'Уже не актуально: эту публикацию убрали из плана',
  published: 'Готово: публикация отмечена как сделанная',
};
