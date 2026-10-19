import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_KIT_PATH,
  KITS_STORAGE_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
} from '../constants';
import { KitRequest, PlanItem, PublicationKit, ScheduleDraft, Strategy } from '../models';
import { Access } from './access';
import { CalendarPlan } from './calendar-plan';
import { Kits } from './kits';

const kitUrl = `${API_DEV_URL}${API_KIT_PATH}`;

const strategy: Strategy = {
  summary: 'Ок',
  positioning: 'Аккуратный маникюр',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
    { title: 'Окошки', description: '', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 1, posts: 1, stories: 1, note: '' },
  firstSteps: [],
};

const draft: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: '19:00',
};

const kit: PublicationKit = {
  shots: ['Снять руки'],
  frames: [{ visual: 'Руки', overlay: 'Смотрите' }],
  caption: 'Подпись',
  hashtags: ['#маникюр'],
  tip: 'Согласие клиента',
};

describe('Kits', () => {
  let kits: Kits;
  let plan: CalendarPlan;
  let http: HttpTestingController;
  let items: PlanItem[];

  function setUp(): void {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    kits = TestBed.inject(Kits);
    plan = TestBed.inject(CalendarPlan);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('secret-pass');
  }

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
    setUp();
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
    items = plan.items();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('starts with no kits and every item idle', () => {
    expect(kits.statusOf(items[0])).toBe('idle');
    expect(kits.kitFor(items[0])).toBeUndefined();
  });

  it('sends the profile, positioning and publication and stores the kit', async () => {
    const pending = kits.generate(items[0]);
    expect(kits.statusOf(items[0])).toBe('loading');

    const request = http.expectOne(kitUrl);
    expect(request.request.headers.get('Authorization')).toBe('Bearer secret-pass');
    const body = request.request.body as KitRequest;
    expect(body.profile.specialty).toBe('маникюр');
    expect(body.positioning).toBe('Аккуратный маникюр');
    expect(body.format).toBe(items[0].format);
    expect(body.idea).toBe(items[0].idea);
    request.flush(kit);

    expect(await pending).toBe(true);
    expect(kits.statusOf(items[0])).toBe('ready');
    expect(kits.kitFor(items[0])).toEqual(kit);
    expect(JSON.parse(localStorage.getItem(KITS_STORAGE_KEY) ?? '{}')[items[0].id].kit).toEqual(
      kit,
    );
  });

  it('marks the item failed with the server message and allows a retry', async () => {
    const first = kits.generate(items[0]);
    http.expectOne(kitUrl).flush({ error: 'Сбой' }, { status: 502, statusText: 'x' });
    expect(await first).toBe(false);

    expect(kits.statusOf(items[0])).toBe('failed');
    expect(kits.errorOf(items[0])).toBe('Сбой');

    const retry = kits.generate(items[0]);
    http.expectOne(kitUrl).flush(kit);
    expect(await retry).toBe(true);
    expect(kits.errorOf(items[0])).toBeUndefined();
  });

  it('does not start a second request for an item that is already loading', async () => {
    const first = kits.generate(items[0]);

    expect(await kits.generate(items[0])).toBe(false);

    http.expectOne(kitUrl).flush(kit);
    await first;
  });

  it('clears the password and stops on 401', async () => {
    const pending = kits.generate(items[0]);
    http
      .expectOne(kitUrl)
      .flush({ error: 'Неверный пароль' }, { status: 401, statusText: 'Unauthorized' });
    await pending;

    expect(TestBed.inject(Access).granted()).toBe(false);
  });

  it('prepares only the missing kits of a batch, one by one, with progress', async () => {
    const week = items.slice(0, 3);
    const first = kits.generate(week[0]);
    http.expectOne(kitUrl).flush(kit);
    await first;

    const batch = kits.generateMany(week);
    expect(kits.batch()).toEqual({ done: 0, total: 2 });
    http.expectOne(kitUrl).flush(kit);
    await vi.waitFor(() => expect(kits.batch()?.done).toBe(1));
    http.expectOne(kitUrl).flush(kit);
    await batch;

    expect(kits.batch()).toBeUndefined();
    expect(week.every((item) => kits.statusOf(item) === 'ready')).toBe(true);
  });

  it('keeps going after one item of the batch fails', async () => {
    const batch = kits.generateMany(items.slice(0, 2));
    http.expectOne(kitUrl).flush({ error: 'Сбой' }, { status: 502, statusText: 'x' });
    await vi.waitFor(() => expect(kits.batch()?.done).toBe(1));
    http.expectOne(kitUrl).flush(kit);
    await batch;

    expect(kits.statusOf(items[0])).toBe('failed');
    expect(kits.statusOf(items[1])).toBe('ready');
  });

  it('does nothing when every kit is already prepared', async () => {
    const first = kits.generate(items[0]);
    http.expectOne(kitUrl).flush(kit);
    await first;

    await kits.generateMany([items[0]]);

    expect(kits.batch()).toBeUndefined();
  });

  it('remembers the kits in a new session', async () => {
    const pending = kits.generate(items[0]);
    http.expectOne(kitUrl).flush(kit);
    await pending;

    TestBed.resetTestingModule();
    setUp();

    expect(kits.kitFor(items[0])).toEqual(kit);
  });

  it('ignores a stored kit once the idea of the item changes', async () => {
    const pending = kits.generate(items[0]);
    http.expectOne(kitUrl).flush(kit);
    await pending;

    expect(kits.kitFor({ ...items[0], idea: 'Другая идея' })).toBeUndefined();
  });

  it('drops kits of publications that left the calendar', async () => {
    const pending = kits.generate(items[0]);
    http.expectOne(kitUrl).flush(kit);
    await pending;

    plan.reset();
    TestBed.tick();

    expect(Object.keys(kits.stored())).toEqual([]);
    expect(localStorage.getItem(KITS_STORAGE_KEY)).toBe('{}');
  });

  it('refuses to ask the server without a confirmed profile', async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    setUp();

    expect(await kits.generate(items[0])).toBe(false);
    expect(kits.statusOf(items[0])).toBe('failed');
    http.expectNone(kitUrl);
  });

  it('ignores a corrupted store', () => {
    localStorage.setItem(KITS_STORAGE_KEY, '{not json');
    TestBed.resetTestingModule();
    setUp();

    expect(kits.stored()).toEqual({});

    localStorage.setItem(KITS_STORAGE_KEY, JSON.stringify({ a: { itemId: 'b', kit: 1 } }));
    TestBed.resetTestingModule();
    setUp();

    expect(kits.stored()).toEqual({});
  });
});
