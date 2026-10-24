import { IntakeGoal, IntakePlatform } from '../models';

export const API_INTAKE_PATH = '/api/intake';

export const INTAKE_POLL_MS = 60000;

export const INTAKE_MAX_LINKS = 12;

export const INTAKE_MIN_REFERENCES = 5;

export const INTAKE_MAX_REFERENCES = 100;

export const INTAKE_MAX_NOTE_LENGTH = 2000;

export const INTAKE_SEEN_STORAGE_KEY = 'helper.intake-seen';

export const INTAKE_GOALS: readonly IntakeGoal[] = [
  { id: 'reach', label: 'Увеличить охваты' },
  { id: 'followers', label: 'Больше подписчиков' },
  { id: 'leads', label: 'Больше заявок и записей' },
  { id: 'check', label: 'Поднять средний чек' },
  { id: 'repeat', label: 'Вернуть и удержать клиентов' },
  { id: 'brand', label: 'Узнаваемость и личный бренд' },
  { id: 'expert', label: 'Выглядеть экспертом, вызвать доверие' },
  { id: 'premium', label: 'Привлечь платёжеспособных клиентов' },
  { id: 'engagement', label: 'Больше лайков, комментариев и сохранений' },
  { id: 'schedule', label: 'Заполнить окна в расписании' },
  { id: 'products', label: 'Продавать продукты, курсы и сертификаты' },
  { id: 'system', label: 'Вести соцсети регулярно и без выгорания' },
];

export const INTAKE_PLATFORM_LABELS: Record<IntakePlatform, string> = {
  instagram: 'Instagram*',
  vk: 'ВКонтакте',
  telegram: 'Telegram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  ok: 'Одноклассники',
  dzen: 'Дзен',
  rutube: 'RuTube',
  max: 'MAX',
  other: 'Сайт или другое',
};

export const INTAKE_PLATFORM_HOSTS: Record<string, IntakePlatform> = {
  'instagram.com': 'instagram',
  'vk.com': 'vk',
  'vk.ru': 'vk',
  'vkontakte.ru': 'vk',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'telegram.org': 'telegram',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'tiktok.com': 'tiktok',
  'ok.ru': 'ok',
  'dzen.ru': 'dzen',
  'zen.yandex.ru': 'dzen',
  'rutube.ru': 'rutube',
  'max.ru': 'max',
};

export const INTAKE_TEXTS = {
  metaNote:
    '* Instagram принадлежит компании Meta, признанной в России экстремистской организацией и запрещённой.',
  open: 'Заявка на контент-план',
  title: 'Контент-план для вас',
  closeLabel: 'Закрыть заявку',
  intro:
    'Расскажите, где вас найти и чего вы хотите добиться. Я изучу ваши соцсети, познакомлюсь с вами и подготовлю план публикаций с примерами кадров. Это занимает время, поэтому готовый план появится у вас в приложении.',
  linksTitle: 'Ваши соцсети',
  linksHint:
    'Вставьте ссылку на каждую страницу, которую ведёте: Instagram*, ВКонтакте, Telegram и другие.',
  linkLabel: 'Ссылка на соцсеть',
  linkPlaceholder: 'Например, vk.com/anna_nails',
  addLink: 'Добавить ещё одну соцсеть',
  removeLink: 'Убрать ссылку',
  referencesTitle: 'На кого равняться',
  referencesHint:
    'Страницы, чей контент и подачу стоит взять за образец или переработать под себя: коллеги, блогеры, даже из другой ниши. Я изучу их вместе с вашими страницами и учту в плане. Заполните сколько есть, пять мест уже готовы, можно добавить сколько угодно ещё.',
  referenceLabel: 'Ссылка на страницу-референс',
  referencePlaceholder: 'Например, instagram.com/master_nails*',
  addReference: 'Добавить ещё референс',
  removeReference: 'Убрать референс',
  referencesCounter: 'Заполнено',
  referencesSummary: 'Референсы',
  goalsTitle: 'Что хотите получить',
  goalsHint: 'Отметьте всё, что для вас важно.',
  cityTitle: 'Где вы работаете',
  cityHint:
    'Название города или посёлка нужно, чтобы напоминания приходили в ваше время. Это поле можно не заполнять: тогда напишите населённый пункт в пожеланиях ниже.',
  cityPlaceholder: 'Например, Иркутск',
  cityLabel: 'Населённый пункт',
  noteLocationHint:
    'Если не заполнили населённый пункт выше, напишите здесь, в каком городе или посёлке вы работаете: по нему я определю ваш часовой пояс для напоминаний.',
  noteTitle: 'Пожелания и рекомендации',
  noteHint:
    'Всё, что стоит учесть в плане: о чём писать и о чём нет, как вы работаете, что уже пробовали, какие у вас ограничения. Эти пожелания я учту при составлении плана.',
  notePlaceholder:
    'Например: не хочу показывать лицо, люблю снимать процесс работы, сторис получаются лучше, чем посты, свободна по вторникам и четвергам',
  noteCounter: 'знаков',
  submit: 'Отправить заявку',
  resubmit: 'Сохранить изменения',
  sending: 'Отправляю…',
  sentTitle: 'Заявка отправлена',
  sentText:
    'Я получил вашу заявку и займусь ею. Когда план будет готов, он появится в приложении: откройте его позже, всё придёт само.',
  sentWishes: 'Ваши пожелания',
  edit: 'Изменить заявку',
  readyTitle: 'План готов',
  readyText: 'Стратегия, календарь публикаций и примеры кадров уже в приложении.',
  readyNote: 'От меня',
  openCalendar: 'Открыть календарь',
  again: 'Заказать новый план',
  cancel: 'Отмена',
  failed: 'Не удалось отправить заявку. Попробуйте ещё раз',
  loadFailed: 'Не удалось узнать состояние заявки',
  goals: 'Цели',
  links: 'Соцсети',
} as const;
