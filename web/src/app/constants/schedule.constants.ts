import { PostFormat, ScheduleDraft, StrategyCadence } from '../models';

export const CALENDAR_STORAGE_KEY = 'helper.calendar';

export const PLAN_WEEKS = 4;

export const MAX_PER_WEEK = 14;

export const CONTENT_DAY_DURATION_MINUTES = 120;

export const CONTENT_DAY_ALARM_MINUTES = 60;

export const ITEM_DURATION_MINUTES = 15;

export const ITEM_ALARM_MINUTES = 15;

export const DEFAULT_PUBLISH_TIME = '19:00';

export const DEFAULT_CADENCE: StrategyCadence = { reels: 1, posts: 1, stories: 3, note: '' };

export const GENERIC_PILLAR_TITLE = 'Свободная тема';

export const WEEKDAY_NAMES: readonly string[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

export const ICS_WEEKDAY_CODES: readonly string[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const FORMAT_LABELS: Record<PostFormat, string> = {
  reels: 'Reels',
  post: 'Пост',
  stories: 'Сторис',
};

export const FORMAT_ORDER: readonly PostFormat[] = ['reels', 'post', 'stories'];

export const DEFAULT_DRAFT: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: DEFAULT_PUBLISH_TIME,
};

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const ICS_FILE_NAME = 'pomoshchnik-calendar.ics';

export const ICS_PRODUCT_ID = '-//Pomoshchnik//Content calendar//RU';

export const ICS_LINE_LIMIT_OCTETS = 75;

export const CALENDAR_OPEN_LABEL = 'Календарь';

export const CALENDAR_CLOSE_LABEL = 'Закрыть календарь';

export const CALENDAR_TITLE = 'Календарь публикаций';

export const CALENDAR_HINT =
  'Выберите, когда вам удобно один-два раза в неделю потратить около двух часов и снять материал на неделю вперёд. Приложение расставит публикации и подготовит файл для календаря телефона.';

export const CONTENT_DAY_TITLE = 'День контента';

export const CONTENT_DAY_FIRST_LABEL = 'Первый день';

export const CONTENT_DAY_SECOND_LABEL = 'Второй день (необязательно)';

export const NO_SECOND_DAY_LABEL = 'Не нужен';

export const TIME_LABEL = 'Во сколько';

export const PUBLISH_TIME_LABEL = 'Время публикаций';

export const TIME_ERROR_TEXT = 'Укажите время';

export const SAME_DAY_ERROR_TEXT = 'Выберите разные дни';

export const BUILD_PLAN_LABEL = 'Составить календарь на 4 недели';

export const REBUILD_PLAN_LABEL = 'Составить календарь заново';

export const EXPORT_LABEL = 'Добавить в календарь телефона';

export const EXPORT_HINT =
  'Напоминания придут от календаря телефона. Если поменяете время, составьте календарь заново и удалите старые события в календаре вручную.';

export const PLAN_TITLE = 'План публикаций';

export const PLAN_EMPTY_TEXT = 'Календаря пока нет. Выберите день контента и составьте его.';

export const DONE_LABEL = 'Опубликовано';

export const WEEK_LABEL = 'Неделя';

export const CONTENT_DAY_WEEK_LABEL = 'День контента';

export const STRATEGY_CALENDAR_LABEL = 'Календарь публикаций';

export const CONTENT_DAY_EVENT_TITLE = 'День контента';

export const CONTENT_DAY_EVENT_TEXT =
  'Время снять фото, видео и сторис на неделю вперёд. Откройте «Помощник» и посмотрите, что снимать.';

export const ITEM_EVENT_TEXT = 'Пора публиковать. Откройте «Помощник», чтобы посмотреть план.';
