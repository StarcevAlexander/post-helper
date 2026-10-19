import { OnboardingStep } from '../models';

export const ONBOARDING_STORAGE_KEY = 'helper.onboarding';

export const MAX_ANSWER_RUNES = 1500;

export const MAX_NAME_RUNES = 40;

export const SKIP_WORDS: readonly string[] = ['пропустить', 'пропуск', 'не знаю', 'нет', '-'];

export const BACK_WORDS: readonly string[] = ['назад', 'вернуться', 'вернуться назад'];

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    field: 'name',
    label: 'Имя',
    question: 'Как вас зовут?',
    example: 'Анна',
    kind: 'name',
    minChars: 2,
    required: false,
  },
  {
    field: 'specialty',
    label: 'Чем вы занимаетесь',
    question: 'Чем вы занимаетесь? Например: маникюр, брови, ресницы, стрижки, макияж.',
    example: 'маникюр и педикюр',
    kind: 'text',
    minChars: 4,
    required: true,
  },
  {
    field: 'city',
    label: 'Город',
    question: 'В каком городе вы принимаете клиентов?',
    example: 'Иркутск',
    kind: 'text',
    minChars: 2,
    required: false,
  },
  {
    field: 'experience',
    label: 'Опыт',
    question: 'Сколько лет вы в профессии и чем гордитесь? Обучение, награды, любимые работы.',
    example: '5 лет, закончила курсы, люблю нюдовые дизайны',
    kind: 'text',
    minChars: 4,
    required: false,
  },
  {
    field: 'services',
    label: 'Услуги и цены',
    question: 'Какие услуги вы делаете и сколько они стоят? Можно примерно.',
    example: 'маникюр 2000, покрытие гель-лаком 2500',
    kind: 'text',
    minChars: 4,
    required: false,
  },
  {
    field: 'clients',
    label: 'Ваши клиенты',
    question: 'Кто ваши клиенты? Возраст, чего они обычно хотят.',
    example: 'женщины 25-45, хотят аккуратно и быстро',
    kind: 'text',
    minChars: 4,
    required: false,
  },
  {
    field: 'goal',
    label: 'Цель',
    question: 'Чего вы хотите от Instagram? Больше записей, дороже услуги, заполнить окошки?',
    example: 'больше записей и заполнить окошки',
    kind: 'text',
    minChars: 4,
    required: false,
  },
  {
    field: 'instagram',
    label: 'Instagram',
    question:
      'Пришлите ник или ссылку на ваш Instagram. Если аккаунта пока нет, напишите «пропустить».',
    example: 'anna_nails или https://instagram.com/anna_nails',
    kind: 'handle',
    minChars: 3,
    required: false,
  },
  {
    field: 'style',
    label: 'Как вы говорите с клиентами',
    question:
      'Напишите пару фраз так, как вы обычно говорите с клиентами. Так я подберу ваш стиль текстов.',
    example: 'Привет! Давайте сделаем вам красивые ручки, выбирайте время',
    kind: 'text',
    minChars: 10,
    required: false,
  },
];

export const ONBOARDING_INTRO_TEXT =
  'Здравствуйте! Я помогу вести Instagram так, чтобы это не отнимало много времени и приводило клиентов. Сначала познакомимся: отвечайте текстом или голосом. Любой вопрос, кроме главного, можно пропустить словом «пропустить», а если ошиблись, напишите «назад». В конце вы проверите все ответы и сможете их поправить.';

export const ONBOARDING_REPEAT_TEXT =
  'Без этого я не смогу составить стратегию. Напишите хотя бы пару слов.';

export const ONBOARDING_REVIEW_TEXT =
  'Спасибо! Теперь проверьте анкету: откройте её кнопкой в шапке, поправьте что нужно и нажмите «Всё верно». Пока вы не подтвердите, стратегию я составлять не буду.';

export const ONBOARDING_REVIEWING_REMINDER_TEXT =
  'Сначала подтвердите анкету: кнопка со списком в шапке открывает её для проверки.';

export const ONBOARDING_FIRST_QUESTION_BACK_TEXT = 'Это первый вопрос, назад некуда.';

export const ONBOARDING_BACK_TEXT = 'Хорошо, вернёмся.';

export const ONBOARDING_PREVIOUS_ANSWER_LABEL = 'Сейчас записано';

export const ANSWER_SKIP_HINT = 'Или напишите «пропустить».';

export const ANSWER_EMPTY_HINT = 'Или оставьте поле пустым.';

export const ANSWER_REASONS = {
  tooShort: 'Слишком коротко. Напишите словами, например:',
  junk: 'Не получилось разобрать ответ. Напишите обычными словами, например:',
  noLetters: 'В ответе нужны слова, а не только цифры или значки. Например:',
  name: 'Напишите только имя, без цифр и лишних слов, например:',
  handle: 'Пришлите ник латиницей или ссылку на профиль, например:',
  requiredEmpty: 'Расскажите, чем вы занимаетесь, например:',
} as const;

export const JUNK_ANSWERS: readonly string[] = [
  'тест',
  'test',
  'хз',
  'ничего',
  'любое',
  'что угодно',
  'не важно',
  'не скажу',
  'qwerty',
  'asdf',
  'йцукен',
];

export const KEYBOARD_ROWS: readonly string[] = [
  'йцукенгшщзх',
  'фывапролджэ',
  'ячсмитьбю',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

export const VOWELS = 'аеёиоуыэюяaeiouy';

export const KEYBOARD_MASH_LENGTH = 5;

export const MAX_LETTER_REPEAT = 4;

export const MAX_CONSONANT_RUN = 6;

export const MIN_CHECKED_WORD_LENGTH = 4;

export const HANDLE_PATTERN =
  /^(https?:\/\/)?(www\.)?(instagram\.com\/)?@?[A-Za-z0-9._]{2,30}\/?(\?.*)?$/;

export const NAME_PATTERN = /^\p{L}[\p{L} '’.-]{1,39}$/u;

export const PROFILE_OPEN_LABEL = 'Анкета';

export const PROFILE_CLOSE_LABEL = 'Закрыть анкету';

export const PROFILE_TITLE = 'Ваша анкета';

export const PROFILE_HINT =
  'Проверьте ответы и поправьте всё, что хотите. Пустыми можно оставить все поля, кроме «Чем вы занимаетесь».';

export const PROFILE_CONFIRM_LABEL = 'Всё верно, составить стратегию';

export const PROFILE_UPDATE_LABEL = 'Сохранить и составить стратегию заново';
