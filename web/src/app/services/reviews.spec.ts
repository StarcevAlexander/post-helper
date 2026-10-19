import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_REVIEW_PATH,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  REVIEWS_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
} from '../constants';
import { ReviewRequest, ReviewResult, ScheduleDraft, Strategy } from '../models';
import { Access } from './access';
import { CalendarPlan } from './calendar-plan';
import { Onboarding } from './onboarding';
import { Reviews } from './reviews';

const reviewUrl = `${API_DEV_URL}${API_REVIEW_PATH}`;

const strategy: Strategy = {
  summary: 'Ок',
  positioning: 'Аккуратный маникюр',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
    { title: 'Окошки', description: '', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 1, posts: 1, stories: 3, note: 'Лучше мало' },
  firstSteps: [],
};

const draft: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: '19:00',
};

const result: ReviewResult = {
  headline: 'Хороший старт',
  whatWorked: ['Сторис с окошками'],
  whatToChange: ['Снимайте пачкой'],
  nextFocus: 'Два Reels',
  cadence: { reels: 2, posts: 1, stories: 4 },
  newIdeas: [
    { pillar: 'окошки', ideas: ['Окошки на выходные', 'Свободно в пятницу'] },
    { pillar: 'Неизвестная рубрика', ideas: ['Не должна попасть'] },
  ],
};

describe('Reviews', () => {
  let reviews: Reviews;
  let plan: CalendarPlan;
  let onboarding: Onboarding;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр', city: 'Иркутск' },
        confirmed: true,
      }),
    );
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(strategy));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    reviews = TestBed.inject(Reviews);
    plan = TestBed.inject(CalendarPlan);
    onboarding = TestBed.inject(Onboarding);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('sends the profile, the week with its done marks and the answers', async () => {
    const week = plan.weeks()[0];
    plan.toggleDone(week.items[0].id);
    const pending = reviews.submit(plan.weeks()[0], {
      inquiries: 4,
      bestIdea: 'Видео',
      hard: 'мало времени',
    });

    const request = http.expectOne(reviewUrl);
    expect(request.request.headers.get('Authorization')).toBe('Bearer ABCDE-FGHJK-LMNPQ-RSTUV');
    const body = request.request.body as ReviewRequest;
    expect(body.profile.specialty).toBe('маникюр');
    expect(body.positioning).toBe('Аккуратный маникюр');
    expect(body.cadence.reels).toBe(1);
    expect(body.items.length).toBe(week.items.length);
    expect(body.items[0].done).toBe(true);
    expect(body.items[1].done).toBe(false);
    expect(body.results).toEqual({ inquiries: 4, bestIdea: 'Видео', hard: 'мало времени' });
    request.flush(result);

    expect(await pending).toBe(true);
    expect(reviews.forWeek(week.from)?.result.headline).toBe('Хороший старт');
    expect(reviews.forWeek(week.from)?.applied).toBe(false);
    expect(reviews.busy()).toBe(false);
  });

  it('remembers the reviews in a new session', async () => {
    const week = plan.weeks()[0];
    const pending = reviews.submit(week, { bestIdea: '', hard: '' });
    http.expectOne(reviewUrl).flush(result);
    await pending;

    TestBed.resetTestingModule();
    const restored = TestBed.inject(Reviews);

    expect(restored.forWeek(week.from)?.result.cadence.reels).toBe(2);
  });

  it('shows the server message and keeps nothing when the request fails', async () => {
    const week = plan.weeks()[0];
    const pending = reviews.submit(week, { bestIdea: '', hard: '' });
    http.expectOne(reviewUrl).flush({ error: 'Сбой' }, { status: 502, statusText: 'x' });

    expect(await pending).toBe(false);
    expect(reviews.error()).toBe('Сбой');
    expect(reviews.forWeek(week.from)).toBeUndefined();
    expect(reviews.busy()).toBe(false);
  });

  it('signs out when the code is refused', async () => {
    const pending = reviews.submit(plan.weeks()[0], { bestIdea: '', hard: '' });
    http.expectOne(reviewUrl).flush({ error: 'Неверный код' }, { status: 401, statusText: 'x' });
    await pending;

    expect(TestBed.inject(Access).granted()).toBe(false);
  });

  it('refuses a second request while one is running', async () => {
    const first = reviews.submit(plan.weeks()[0], { bestIdea: '', hard: '' });

    expect(await reviews.submit(plan.weeks()[0], { bestIdea: '', hard: '' })).toBe(false);

    http.expectOne(reviewUrl).flush(result);
    await first;
  });

  it('applies the advice: new rhythm, new ideas in the right pillar, calendar rebuilt', async () => {
    const week = plan.weeks()[0];
    const pending = reviews.submit(week, { bestIdea: '', hard: '' });
    http.expectOne(reviewUrl).flush(result);
    await pending;
    plan.toggleDone(plan.items()[0].id);
    const revision = onboarding.strategyRevision();

    expect(reviews.apply(week.from)).toBe(true);

    const updated = onboarding.strategy();
    expect(updated?.cadence).toEqual({ reels: 2, posts: 1, stories: 4, note: 'Лучше мало' });
    expect(updated?.pillars[2].ideas).toEqual(['Свободно в пятницу', 'Окошки на выходные']);
    expect(updated?.pillars[0].ideas).toEqual(['Кадр до']);
    expect(plan.items().filter((item) => item.format === 'reels').length).toBe(8);
    expect(plan.items().some((item) => item.done)).toBe(false);
    expect(reviews.forWeek(week.from)?.applied).toBe(true);
    expect(onboarding.strategyRevision()).toBe(revision);
    expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY) ?? '{}').cadence.reels).toBe(2);
  });

  it('does not apply a review that does not exist', () => {
    expect(reviews.apply('2026-01-01')).toBe(false);
  });

  it('ignores a corrupted store', () => {
    localStorage.setItem(REVIEWS_STORAGE_KEY, '{not json');
    TestBed.resetTestingModule();
    expect(TestBed.inject(Reviews).items()).toEqual({});

    localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify({ a: { weekFrom: 'b' } }));
    TestBed.resetTestingModule();
    expect(TestBed.inject(Reviews).items()).toEqual({});
  });

  it('opens and closes a week view', () => {
    const week = plan.weeks()[1];

    reviews.view(week);
    expect(reviews.viewing()?.from).toBe(week.from);

    reviews.closeView();
    expect(reviews.viewing()).toBeUndefined();
  });
});
