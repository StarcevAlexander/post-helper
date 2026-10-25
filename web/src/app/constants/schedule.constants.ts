import { PostFormat } from '../models';

export const CALENDAR_STORAGE_KEY = 'helper.calendar';

export const PLAN_WEEKS = 4;

export const WEEKDAY_NAMES: readonly string[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

export const FORMAT_LABELS: Record<PostFormat, string> = {
  reels: 'Reels',
  post: 'Пост',
  stories: 'Сторис',
};

export const FORMAT_ORDER: readonly PostFormat[] = ['reels', 'post', 'stories'];

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const CALENDAR_CLOSE_LABEL = 'Закрыть календарь';

export const CALENDAR_TITLE = 'Календарь публикаций';

export const CALENDAR_HINT =
  'План публикаций, который я для вас составил. Отмечайте опубликованное, напоминания приходят уведомлениями из приложения.';

export const PLAN_TITLE = 'План публикаций';

export const PLAN_EMPTY_TEXT =
  'Плана пока нет. Отправьте заявку на контент-план, и он появится здесь.';

export const DONE_LABEL = 'Опубликовано';

export const WEEK_LABEL = 'Неделя';

export const CONTENT_DAY_WEEK_LABEL = 'День контента';
