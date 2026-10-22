import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_AUDIT_JOBS_PATH,
  API_CHAT_PATH,
  API_DEV_URL,
  API_STRATEGY_PATH,
  ONBOARDING_FIRST_QUESTION_BACK_TEXT,
  ONBOARDING_INTRO_TEXT,
  ONBOARDING_REPEAT_TEXT,
  ONBOARDING_REVIEWING_REMINDER_TEXT,
  ONBOARDING_REVIEW_TEXT,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_READY_TEXT,
  STRATEGY_STORAGE_KEY,
  WELCOME_TEXT,
} from '../constants';
import { MasterProfile, ProfileField, StoredOnboarding, Strategy } from '../models';
import { Access } from './access';
import { CalendarPlan } from './calendar-plan';
import { Chat } from './chat';
import { Onboarding } from './onboarding';

const strategyUrl = `${API_DEV_URL}${API_STRATEGY_PATH}`;
const jobsUrl = `${API_DEV_URL}${API_AUDIT_JOBS_PATH}`;

const VALID_ANSWERS: Record<ProfileField, string> = {
  name: 'Анна',
  specialty: 'маникюр и педикюр',
  city: 'Иркутск',
  experience: '5 лет, закончила курсы',
  services: 'маникюр 2000, покрытие 2500',
  clients: 'женщины 25-45, хотят быстро',
  goal: 'больше записей',
  instagram: 'anna_nails',
  style: 'Привет! Давайте сделаем вам красивые ручки',
  audit: '',
};

const strategy: Strategy = {
  summary: 'Вы мастер маникюра',
  positioning: 'Аккуратный маникюр без спешки',
  profileFixes: ['Добавьте город в имя'],
  pillars: [
    { title: 'До и после', description: 'Показывает результат', ideas: ['Кадр до'] },
    { title: 'Процесс', description: 'Руки за работой', ideas: ['Видео шлифовки'] },
    { title: 'Окошки', description: 'Приводит записи', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 2, posts: 2, stories: 5, note: 'Лучше мало, но регулярно' },
  firstSteps: ['Поправьте шапку'],
};

describe('Chat onboarding', () => {
  let chat: Chat;
  let onboarding: Onboarding;
  let http: HttpTestingController;

  function setUp(optional = false): void {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    onboarding = TestBed.inject(Onboarding);
    if (!optional) {
      onboarding.start();
    }
    chat = TestBed.inject(Chat);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('secret-pass');
  }

  function answerAll(skip: readonly ProfileField[] = []): void {
    ONBOARDING_STEPS.forEach((step) => {
      chat.send({
        text: skip.includes(step.field) ? 'пропустить' : VALID_ANSWERS[step.field],
        attachments: [],
      });
    });
  }

  function confirmReview(): void {
    onboarding.saveDraft(onboarding.toDraft());
    chat.buildStrategy();
  }

  function lastText(): string | undefined {
    return chat.messages().at(-1)?.text;
  }

  beforeEach(() => {
    localStorage.clear();
    setUp();
  });

  afterEach(() => {
    http.match({ method: 'POST', url: jobsUrl }).forEach((request) => request.flush({}));
    http.verify();
    localStorage.clear();
  });

  it('orders the analysis of the instagram account as soon as the answer is accepted', () => {
    for (const step of ONBOARDING_STEPS) {
      chat.send({ text: VALID_ANSWERS[step.field], attachments: [] });
      if (step.field === 'instagram') {
        break;
      }
    }

    const request = http.expectOne({ method: 'POST', url: jobsUrl });
    expect(request.request.body).toEqual({ handle: 'anna_nails', consent: true });
    request.flush({
      id: 'j1',
      handle: 'anna_nails',
      status: 'queued',
      createdAt: '2026-10-19T08:00:00Z',
    });
  });

  it('orders the analysis when the instagram link is added while checking the answers', () => {
    answerAll(['instagram']);
    http.expectNone({ method: 'POST', url: jobsUrl });

    onboarding.saveDraft({ ...onboarding.toDraft(), instagram: 'massage_experience' });
    chat.buildStrategy();

    const order = http.expectOne({ method: 'POST', url: jobsUrl });
    expect(order.request.body).toEqual({ handle: 'massage_experience', consent: true });
    order.flush({
      id: 'j1',
      handle: 'massage_experience',
      status: 'queued',
      createdAt: '2026-10-19T08:00:00Z',
    });
    http.expectOne(strategyUrl).flush(strategy);
  });

  it('does not order the analysis when the instagram question is skipped', () => {
    for (const step of ONBOARDING_STEPS) {
      chat.send({
        text: step.field === 'instagram' ? 'пропустить' : VALID_ANSWERS[step.field],
        attachments: [],
      });
      if (step.field === 'instagram') {
        break;
      }
    }

    http.expectNone({ method: 'POST', url: jobsUrl });
  });

  it('starts with an introduction and the first question', () => {
    expect(chat.messages().length).toBe(2);
    expect(chat.messages()[1].text).toContain(`1 из ${ONBOARDING_STEPS.length}`);
    expect(chat.messages()[1].text).toContain(ONBOARDING_STEPS[0].question);
    expect(onboarding.active()).toBe(true);
  });

  it('asks the next question locally without calling the server', () => {
    chat.send({ text: 'Анна', attachments: [] });

    expect(chat.messages().length).toBe(4);
    expect(chat.messages()[2].text).toBe('Анна');
    expect(chat.messages()[3].text).toContain(`2 из ${ONBOARDING_STEPS.length}`);
    expect(chat.busy()).toBe(false);
    expect(onboarding.answers().name).toBe('Анна');
  });

  it('insists on the required question and asks it again', () => {
    chat.send({ text: 'Анна', attachments: [] });
    chat.send({ text: 'пропустить', attachments: [] });

    expect(onboarding.index()).toBe(1);
    const last = chat.messages().slice(-2);
    expect(last[0].text).toBe(ONBOARDING_REPEAT_TEXT);
    expect(last[1].text).toContain(ONBOARDING_STEPS[1].question);
  });

  describe('garbage answers', () => {
    it.each(['аааааааа', 'фывапролд', 'asdfghjkl', '12345', '😀😀😀', 'тест'])(
      'does not accept %s as the specialty and stays on the question',
      (text) => {
        chat.send({ text: 'Анна', attachments: [] });
        const before = chat.messages().length;

        chat.send({ text, attachments: [] });

        expect(onboarding.index()).toBe(1);
        expect(onboarding.answers().specialty).toBeUndefined();
        expect(chat.messages().length).toBe(before + 2);
        expect(lastText()).toMatch(/например/i);
        expect(chat.busy()).toBe(false);
      },
    );

    it('explains how to write a name and keeps the question', () => {
      chat.send({ text: 'Анна123', attachments: [] });

      expect(onboarding.index()).toBe(0);
      expect(lastText()).toContain('только имя');
    });

    it('asks for a latin handle instead of free text for the instagram question', () => {
      for (const step of ONBOARDING_STEPS.slice(0, 7)) {
        chat.send({ text: VALID_ANSWERS[step.field], attachments: [] });
      }

      chat.send({ text: 'мой инстаграм', attachments: [] });

      expect(onboarding.index()).toBe(7);
      expect(lastText()).toContain('anna_nails');
    });

    it('lets the user skip an optional question after a rejected answer', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'маникюр', attachments: [] });
      chat.send({ text: 'ы', attachments: [] });
      expect(onboarding.index()).toBe(2);

      chat.send({ text: 'пропустить', attachments: [] });

      expect(onboarding.index()).toBe(3);
      expect(onboarding.answers().city).toBeUndefined();
    });
  });

  describe('changing answers', () => {
    it('goes back one question on "назад" and shows the stored answer', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'маникюр', attachments: [] });

      chat.send({ text: 'Назад', attachments: [] });

      expect(onboarding.index()).toBe(1);
      const last = chat.messages().slice(-2);
      expect(last[0].text).toContain('маникюр');
      expect(last[1].text).toContain(ONBOARDING_STEPS[1].question);
    });

    it('overwrites the earlier answer after going back', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'маникюр', attachments: [] });
      chat.send({ text: 'назад', attachments: [] });

      chat.send({ text: 'брови и ресницы', attachments: [] });

      expect(onboarding.answers().specialty).toBe('брови и ресницы');
      expect(onboarding.index()).toBe(2);
    });

    it('drops an answer that is skipped after going back', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'назад', attachments: [] });

      chat.send({ text: 'пропустить', attachments: [] });

      expect(onboarding.answers().name).toBeUndefined();
    });

    it('says there is nowhere to go back from the first question', () => {
      chat.send({ text: 'назад', attachments: [] });

      expect(lastText()).toBe(ONBOARDING_FIRST_QUESTION_BACK_TEXT);
      expect(onboarding.index()).toBe(0);
    });
  });

  describe('review before the strategy', () => {
    it('does not ask the server after the last answer and waits for confirmation', () => {
      answerAll();

      expect(lastText()).toBe(ONBOARDING_REVIEW_TEXT);
      expect(onboarding.reviewing()).toBe(true);
      expect(onboarding.confirmed()).toBe(false);
      expect(chat.busy()).toBe(false);
    });

    it('reminds to confirm when the user keeps typing during the review', () => {
      answerAll();

      chat.send({ text: 'ну что там', attachments: [] });

      expect(lastText()).toBe(ONBOARDING_REVIEWING_REMINDER_TEXT);
      expect(onboarding.reviewing()).toBe(true);
    });

    it('does not store skipped optional answers', () => {
      answerAll(['city', 'style']);

      expect(onboarding.answers().city).toBeUndefined();
      expect(onboarding.answers().specialty).toBe(VALID_ANSWERS.specialty);
    });

    it('lets the user correct an answer in the review and uses the corrected profile', async () => {
      answerAll();
      onboarding.saveDraft({ ...onboarding.toDraft(), city: 'Ангарск', style: '' });
      chat.buildStrategy();

      const request = http.expectOne(strategyUrl);
      const profile = request.request.body as MasterProfile;
      expect(profile.city).toBe('Ангарск');
      expect(profile.style).toBeUndefined();
      request.flush(strategy);
      await vi.waitFor(() => expect(chat.busy()).toBe(false));
    });

    it('asks the server for a strategy once confirmed and stores it', async () => {
      answerAll();
      confirmReview();

      expect(chat.busy()).toBe(true);
      const request = http.expectOne(strategyUrl);
      expect(request.request.headers.get('Authorization')).toBe('Bearer secret-pass');
      expect((request.request.body as MasterProfile).specialty).toBe(VALID_ANSWERS.specialty);
      request.flush(strategy);
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      expect(onboarding.strategy()).toEqual(strategy);
      expect(lastText()).toBe(STRATEGY_READY_TEXT);
      expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY) ?? '{}')).toEqual(strategy);
    });

    it('returns to the review when the server finds the data insufficient', async () => {
      answerAll();
      confirmReview();

      http
        .expectOne(strategyUrl)
        .flush(
          { error: 'Не хватает данных для стратегии. Непонятно, чем вы занимаетесь' },
          { status: 422, statusText: 'Unprocessable Entity' },
        );
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      expect(onboarding.reviewing()).toBe(true);
      expect(onboarding.strategy()).toBeUndefined();
      expect(lastText()).toContain('Непонятно, чем вы занимаетесь');
    });

    it('keeps the answers when the strategy fails and builds it again on demand', async () => {
      answerAll();
      confirmReview();
      http.expectOne(strategyUrl).flush({ error: 'Сбой' }, { status: 502, statusText: 'x' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      expect(onboarding.strategy()).toBeUndefined();
      expect(onboarding.profile()?.specialty).toBe(VALID_ANSWERS.specialty);
      expect(chat.messages().at(-1)?.failed).toBe(true);

      chat.buildStrategy();
      http.expectOne(strategyUrl).flush(strategy);
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      expect(onboarding.strategy()).toEqual(strategy);
    });
  });

  describe('editing an answer', () => {
    function answerBy(field: ProfileField) {
      return chat.messages().find((message) => message.answerFor === field);
    }

    it('marks accepted answers and flags the bot messages of the onboarding', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'ыыыыыы', attachments: [] });

      expect(answerBy('name')?.text).toBe('Анна');
      const rejected = chat.messages().find((message) => message.text === 'ыыыыыы');
      expect(rejected?.answerFor).toBeUndefined();
      const bot = chat.messages().filter((message) => message.role === 'assistant');
      expect(bot.length).toBeGreaterThan(2);
      expect(bot.every((message) => message.onboarding)).toBe(true);
    });

    it('goes back to that question, shows the old answer and then resumes where it was', () => {
      ['Анна', 'маникюр', 'Иркутск', '5 лет в профессии'].forEach((text) =>
        chat.send({ text, attachments: [] }),
      );
      expect(onboarding.index()).toBe(4);

      chat.editAnswer(answerBy('name')?.id ?? '');

      expect(onboarding.index()).toBe(0);
      const last = chat.messages().slice(-2);
      expect(last[0].text).toContain('Анна');
      expect(last[1].text).toContain(`1 из ${ONBOARDING_STEPS.length}`);

      chat.send({ text: 'Аня', attachments: [] });

      expect(onboarding.answers().name).toBe('Аня');
      expect(onboarding.index()).toBe(4);
      expect(lastText()).toContain(`5 из ${ONBOARDING_STEPS.length}`);
      expect(onboarding.editing()).toBe(false);
    });

    it('keeps one edit button per question after the answer is replaced', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'маникюр', attachments: [] });
      const old = answerBy('name');

      chat.editAnswer(old?.id ?? '');
      chat.send({ text: 'Аня', attachments: [] });

      const owners = chat.messages().filter((message) => message.answerFor === 'name');
      expect(owners.length).toBe(1);
      expect(owners[0].text).toBe('Аня');
      expect(chat.messages().find((message) => message.id === old?.id)?.answerFor).toBeUndefined();
    });

    it('stays on the question after a rejected new answer and still resumes later', () => {
      ['Анна', 'маникюр', 'Иркутск'].forEach((text) => chat.send({ text, attachments: [] }));

      chat.editAnswer(answerBy('specialty')?.id ?? '');
      chat.send({ text: 'ыыыыыы', attachments: [] });

      expect(onboarding.index()).toBe(1);
      expect(onboarding.answers().specialty).toBe('маникюр');
      expect(onboarding.editing()).toBe(true);

      chat.send({ text: 'брови и ресницы', attachments: [] });

      expect(onboarding.answers().specialty).toBe('брови и ресницы');
      expect(onboarding.index()).toBe(3);
    });

    it('clears an optional answer that is skipped while editing', () => {
      ['Анна', 'маникюр', 'Иркутск'].forEach((text) => chat.send({ text, attachments: [] }));

      chat.editAnswer(answerBy('city')?.id ?? '');
      chat.send({ text: 'пропустить', attachments: [] });

      expect(onboarding.answers().city).toBeUndefined();
      expect(onboarding.index()).toBe(3);
    });

    it('keeps the profile available while an answer is being edited', () => {
      answerAll();

      chat.editAnswer(answerBy('city')?.id ?? '');

      expect(onboarding.active()).toBe(true);
      expect(onboarding.editing()).toBe(true);
      expect(onboarding.profile()?.specialty).toBe(VALID_ANSWERS.specialty);
    });

    it('returns to the review after an answer is edited in a finished questionnaire', () => {
      answerAll();
      confirmReview();
      http.expectOne(strategyUrl).flush(strategy);

      return vi
        .waitFor(() => expect(chat.busy()).toBe(false))
        .then(() => {
          expect(onboarding.confirmed()).toBe(true);

          chat.editAnswer(answerBy('city')?.id ?? '');
          chat.send({ text: 'Ангарск', attachments: [] });

          expect(onboarding.answers().city).toBe('Ангарск');
          expect(onboarding.reviewing()).toBe(true);
          expect(onboarding.confirmed()).toBe(false);
          expect(lastText()).toBe(ONBOARDING_REVIEW_TEXT);
          expect(onboarding.strategy()).toEqual(strategy);
        });
    });

    it('remembers an edit in progress after a reload', () => {
      ['Анна', 'маникюр', 'Иркутск'].forEach((text) => chat.send({ text, attachments: [] }));
      chat.editAnswer(answerBy('name')?.id ?? '');
      TestBed.tick();

      TestBed.resetTestingModule();
      setUp();

      expect(onboarding.index()).toBe(0);
      expect(onboarding.editing()).toBe(true);
      expect(chat.messages().some((message) => message.answerFor === 'specialty')).toBe(true);
      chat.send({ text: 'Аня', attachments: [] });
      expect(onboarding.index()).toBe(3);
    });

    it('does not edit while a reply is pending or for a message that is not an answer', () => {
      chat.send({ text: 'Анна', attachments: [] });
      const bot = chat.messages().find((message) => message.role === 'assistant');

      chat.editAnswer(bot?.id ?? '');
      chat.editAnswer('unknown-id');
      chat.busy.set(true);
      chat.editAnswer(answerBy('name')?.id ?? '');

      expect(onboarding.index()).toBe(1);
      expect(onboarding.editing()).toBe(false);
    });

    it('does not allow deleting the bot messages or an accepted answer', () => {
      chat.send({ text: 'Анна', attachments: [] });
      const before = chat.messages().length;

      chat.messages().forEach((message) => chat.remove(message.id));

      const left = chat.messages();
      expect(left.every((message) => message.onboarding || message.answerFor)).toBe(true);
      expect(left.length).toBe(before);
    });

    it('still lets a rejected garbage message be deleted', () => {
      chat.send({ text: 'Анна', attachments: [] });
      chat.send({ text: 'ыыыыыы', attachments: [] });
      const garbage = chat.messages().find((message) => message.text === 'ыыыыыы');

      chat.remove(garbage?.id ?? '');

      expect(chat.messages().some((message) => message.text === 'ыыыыыы')).toBe(false);
    });
  });
  it('remembers the progress in a new session', () => {
    chat.send({ text: 'Анна', attachments: [] });
    TestBed.tick();

    TestBed.resetTestingModule();
    setUp();

    expect(onboarding.index()).toBe(1);
    expect(onboarding.answers().name).toBe('Анна');
    expect(chat.messages().map((message) => message.text)).toContain('Анна');
  });

  it('remembers that the review is still pending after a reload', () => {
    answerAll();

    TestBed.resetTestingModule();
    setUp();

    expect(onboarding.reviewing()).toBe(true);
  });

  it('asks the current question again after the conversation is cleared', () => {
    chat.send({ text: 'Анна', attachments: [] });

    chat.clear();

    expect(chat.messages().length).toBe(2);
    expect(chat.messages()[1].text).toContain(`2 из ${ONBOARDING_STEPS.length}`);
  });

  it('forgets the profile and strategy on restart', async () => {
    answerAll();
    confirmReview();
    http.expectOne(strategyUrl).flush(strategy);
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    chat.restartOnboarding();

    expect(onboarding.active()).toBe(true);
    expect(onboarding.strategy()).toBeUndefined();
    expect(onboarding.profile()).toBeUndefined();
    expect(chat.messages().length).toBe(2);
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? 'null')).toEqual({
      index: 0,
      answers: {},
      confirmed: false,
      started: true,
    });
    expect(localStorage.getItem(STRATEGY_STORAGE_KEY)).toBeNull();
  });

  it('drops the calendar together with the profile on restart', async () => {
    answerAll();
    confirmReview();
    http.expectOne(strategyUrl).flush(strategy);
    await vi.waitFor(() => expect(chat.busy()).toBe(false));
    const calendar = TestBed.inject(CalendarPlan);
    calendar.build(calendar.toDraft(), strategy);
    expect(calendar.hasPlan()).toBe(true);

    chat.restartOnboarding();

    expect(calendar.hasPlan()).toBe(false);
  });

  describe('when the acquaintance is optional', () => {
    const chatUrl = `${API_DEV_URL}${API_CHAT_PATH}`;

    function reopen(saved?: StoredOnboarding): void {
      TestBed.resetTestingModule();
      localStorage.clear();
      if (saved) {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(saved));
      }
      setUp(true);
    }

    it('opens a plain chat for a new user without any questions', () => {
      reopen();

      expect(onboarding.started()).toBe(false);
      expect(onboarding.active()).toBe(false);
      expect(onboarding.reviewing()).toBe(false);
      expect(chat.messages().length).toBe(1);
      expect(chat.messages()[0].text).toBe(WELCOME_TEXT);
      expect(chat.messages()[0].onboarding).toBe(false);
    });

    it('sends a message to the assistant instead of treating it as an answer', () => {
      reopen();

      chat.send({ text: 'Привет', attachments: [] });

      http.expectOne(chatUrl).flush({ reply: 'Здравствуйте' });
      expect(onboarding.index()).toBe(0);
      expect(onboarding.answers()).toEqual({});
    });

    it('starts the questions only on request and only once', () => {
      reopen();

      chat.beginOnboarding();
      chat.beginOnboarding();

      expect(onboarding.started()).toBe(true);
      expect(onboarding.active()).toBe(true);
      expect(chat.messages().length).toBe(3);
      expect(chat.messages()[1].text).toBe(ONBOARDING_INTRO_TEXT);
      expect(chat.messages()[2].text).toContain(`1 из ${ONBOARDING_STEPS.length}`);
    });

    it('keeps the questions for someone who already has answers', () => {
      reopen({ index: 2, answers: { specialty: 'маникюр', name: 'Анна' } });

      expect(onboarding.started()).toBe(true);
      expect(onboarding.active()).toBe(true);
    });

    it('treats a finished questionnaire as started', () => {
      reopen({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр' },
        confirmed: true,
      });

      expect(onboarding.started()).toBe(true);
      expect(onboarding.active()).toBe(false);
      expect(onboarding.reviewing()).toBe(false);
    });
  });

  it('ignores an empty answer', () => {
    chat.send({ text: '   ', attachments: [] });

    expect(onboarding.index()).toBe(0);
    expect(chat.messages().length).toBe(2);
  });
});
