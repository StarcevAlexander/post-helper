import { ACCOUNT_TEXTS } from './account.constants';
import { ERROR_LOG_TITLE } from './error-log.constants';
import { INTAKE_TEXTS } from './intake.constants';
import { KIT_TITLE } from './kit.constants';
import { MONTH_REVIEW_TEXTS } from './month-review.constants';
import { RECOMMENDATION_TEXTS } from './recommendation.constants';
import { REFS_TEXTS } from './refs.constants';
import { CALENDAR_TITLE } from './schedule.constants';
import { SETTINGS_TITLE } from './shell.constants';
import { SHOOT_TEXTS } from './shoot.constants';
import { APPEARANCE_TITLE, SCALE_SECTION_TITLE, THEME_SECTION_TITLE } from './theme.constants';
import { TODAY_TEXTS } from './today.constants';

export const NAV_TEXTS = {
  primary: 'Основная навигация',
  today: 'Сегодня',
  calendar: 'Календарь',
  reviews: 'Итоги',
  profile: 'Профиль',
  intake: 'Заявка',
  back: 'Назад',
  brand: 'Помощник',
} as const;

export const ROUTE_TITLES = {
  today: TODAY_TEXTS.title,
  calendar: CALENDAR_TITLE,
  reviews: MONTH_REVIEW_TEXTS.title,
  intake: INTAKE_TEXTS.title,
  profile: RECOMMENDATION_TEXTS.title,
  kit: KIT_TITLE,
  shoot: SHOOT_TEXTS.title,
  refs: REFS_TEXTS.title,
  settings: SETTINGS_TITLE,
} as const;

export const SETTINGS_SECTION_TITLES = {
  appearance: APPEARANCE_TITLE,
  theme: THEME_SECTION_TITLE,
  scale: SCALE_SECTION_TITLE,
  name: ACCOUNT_TEXTS.rename,
  errors: ERROR_LOG_TITLE,
} as const;

export const NAV_TABS = [
  {
    link: '/today',
    label: NAV_TEXTS.today,
    icon: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  },
  {
    link: '/calendar',
    label: NAV_TEXTS.calendar,
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  },
  { link: '/reviews', label: NAV_TEXTS.reviews, icon: 'M18 20V10M12 20V4M6 20v-6' },
  {
    link: '/profile',
    label: NAV_TEXTS.profile,
    icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  },
  {
    link: '/intake',
    label: NAV_TEXTS.intake,
    icon: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2M8 12h8M8 16h5',
  },
] as const;
