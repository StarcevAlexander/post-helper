import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_STRATEGY_PATH,
  ONBOARDING_FIRST_QUESTION_BACK_TEXT,
  ONBOARDING_REPEAT_TEXT,
  ONBOARDING_REVIEWING_REMINDER_TEXT,
  ONBOARDING_REVIEW_TEXT,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_READY_TEXT,
  STRATEGY_STORAGE_KEY,
} from '../constants';
import { MasterProfile, ProfileField, Strategy } from '../models';
import { Access } from './access';
import { CalendarPlan } from './calendar-plan';
import { Chat } from './chat';
import { Onboarding } from './onboarding';

const strategyUrl = `${API_DEV_URL}${API_STRATEGY_PATH}`;

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

  function setUp(): void {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    chat = TestBed.inject(Chat);
    onboarding = TestBed.inject(Onboarding);
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
    http.verify();
    localStorage.clear();
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
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
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

  it('ignores an empty answer', () => {
    chat.send({ text: '   ', attachments: [] });

    expect(onboarding.index()).toBe(0);
    expect(chat.messages().length).toBe(2);
  });
});
