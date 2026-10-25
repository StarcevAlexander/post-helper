import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_ME_PATH,
  API_STATE_PATH,
  CALENDAR_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
  SYNC_BACKUP_STORAGE_KEY,
  SYNC_META_STORAGE_KEY,
  SYNC_PUSH_DELAY_MS,
} from '../constants';
import { Access } from './access';
import { Account } from './account';
import { CalendarPlan } from './calendar-plan';
import { PAGE_RELOAD } from './page-reload';
import { Settings } from './settings';
import { Sync } from './sync';

const meUrl = `${API_DEV_URL}${API_ME_PATH}`;
const stateUrl = `${API_DEV_URL}${API_STATE_PATH}`;

const remoteSettings = { theme: 'dark', scale: 110 };

describe('Sync', () => {
  let http: HttpTestingController;
  let reload: ReturnType<typeof vi.fn>;
  let sync: Sync;
  let account: Account;

  function meta(): { version: number; dirty: boolean } | undefined {
    const raw = localStorage.getItem(SYNC_META_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { version: number; dirty: boolean }) : undefined;
  }

  async function signIn(): Promise<void> {
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http.expectOne(meUrl).flush({ name: 'Анна', retentionDays: 1095 });
    await vi.waitFor(() => expect(account.signedIn()).toBe(true));
    TestBed.tick();
  }

  beforeEach(() => {
    localStorage.clear();
    reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PAGE_RELOAD, useValue: reload },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    account = TestBed.inject(Account);
    sync = TestBed.inject(Sync);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
    localStorage.clear();
  });

  it('loads the saved data on a new phone and reloads the page', async () => {
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 3,
      data: { settings: remoteSettings, strategy: { summary: 'Ок' } },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toEqual(remoteSettings);
    expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY) ?? '{}')).toEqual({
      summary: 'Ок',
    });
    expect(meta()).toEqual({ version: 3, dirty: false });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SYNC_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it('keeps a backup of different local data before taking the server copy', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'ocean', scale: 100 }));
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 2,
      data: { settings: remoteSettings },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(JSON.parse(localStorage.getItem(SYNC_BACKUP_STORAGE_KEY) ?? '{}')).toMatchObject({
      settings: { theme: 'ocean', scale: 100 },
    });
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toEqual(remoteSettings);
  });

  it('does not reload when the server copy equals the local one', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(remoteSettings));
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 5,
      data: { settings: remoteSettings },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(reload).not.toHaveBeenCalled();
    expect(meta()).toEqual({ version: 5, dirty: false });
  });

  it('uploads local data when the server has none', async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(remoteSettings));
    await signIn();

    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: stateUrl }));
    expect(put.request.body).toMatchObject({
      baseVersion: 0,
      data: { settings: remoteSettings },
    });
    put.flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });

    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    expect(meta()).toEqual({ version: 1, dirty: false });
  });

  it('stays quiet when both sides are empty', async () => {
    await signIn();

    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    http.expectNone({ method: 'PUT', url: stateUrl });
  });

  it('settles at once when nothing is waiting to be saved', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    await expect(sync.settle()).resolves.toBe(true);
    http.expectNone({ method: 'PUT', url: stateUrl });
  });

  it('settles by saving the unsaved changes first', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();
    expect(meta()?.dirty).toBe(true);

    const settled = sync.settle();
    http
      .expectOne({ method: 'PUT', url: stateUrl })
      .flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });

    await expect(settled).resolves.toBe(true);
    expect(meta()).toEqual({ version: 1, dirty: false });
  });

  it('reports a failure when the unsaved changes could not be saved', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();

    const settled = sync.settle();
    http
      .expectOne({ method: 'PUT', url: stateUrl })
      .flush({ error: 'сбой' }, { status: 500, statusText: 'Server Error' });

    await expect(settled).resolves.toBe(false);
    expect(meta()?.dirty).toBe(true);
  });

  it('saves a change after a short pause and remembers the new version', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();

    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();
    expect(meta()?.dirty).toBe(true);
    http.expectNone({ method: 'PUT', url: stateUrl });
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);

    const put = http.expectOne({ method: 'PUT', url: stateUrl });
    expect((put.request.body as { baseVersion: number }).baseVersion).toBe(0);
    put.flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
    await vi.waitFor(() => expect(meta()).toEqual({ version: 1, dirty: false }));
    expect(sync.status()).toBe('ok');
  });

  it('sends several quick changes as one request', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();
    const settings = TestBed.inject(Settings);

    settings.setTheme('dark');
    TestBed.tick();
    settings.setScale(120);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);

    const puts = http.match({ method: 'PUT', url: stateUrl });
    expect(puts.length).toBe(1);
    puts[0].flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
  });

  it('retries once on top of the newer server copy when the version is stale', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();

    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    http.expectOne({ method: 'PUT', url: stateUrl }).flush(
      {
        error: 'Данные уже изменены',
        state: { version: 7, data: {}, updatedAt: '2026-10-19T10:00:00Z' },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await vi.advanceTimersByTimeAsync(1);

    const retry = http.expectOne({ method: 'PUT', url: stateUrl });
    expect((retry.request.body as { baseVersion: number }).baseVersion).toBe(7);
    retry.flush({ version: 8, data: {}, updatedAt: '2026-10-19T10:00:05Z' });
    await vi.waitFor(() => expect(meta()).toEqual({ version: 8, dirty: false }));
  });

  it('shows an error and keeps the change for later when the server fails', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();

    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    http
      .expectOne({ method: 'PUT', url: stateUrl })
      .flush({ error: 'Сбой' }, { status: 500, statusText: 'x' });
    await vi.advanceTimersByTimeAsync(1);

    expect(sync.status()).toBe('error');
    expect(meta()?.dirty).toBe(true);
  });

  it('signs out when the code is refused', async () => {
    await signIn();

    http.expectOne(stateUrl).flush({ error: 'Неверный код' }, { status: 401, statusText: 'x' });
    await vi.waitFor(() => expect(TestBed.inject(Access).granted()).toBe(false));

    expect(sync.status()).toBe('off');
  });

  it('keeps the edit made while the request was in flight', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();
    const settings = TestBed.inject(Settings);
    settings.setTheme('dark');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    const first = http.expectOne({ method: 'PUT', url: stateUrl });

    settings.setScale(120);
    TestBed.tick();
    first.flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
    await vi.advanceTimersByTimeAsync(1);

    expect(meta()).toEqual({ version: 1, dirty: true });
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    const second = http.expectOne({ method: 'PUT', url: stateUrl });
    expect((second.request.body as { baseVersion: number }).baseVersion).toBe(1);
    second.flush({ version: 2, data: {}, updatedAt: '2026-10-19T10:00:10Z' });
  });

  it('merges a newer server copy with the unsaved marks instead of overwriting it', async () => {
    const localCalendar = {
      startedOn: '2026-10-13',
      schedule: { slots: [{ weekday: 1, time: '10:00' }], publishTime: '12:00' },
      items: [
        {
          id: 'a',
          date: '2026-10-14',
          time: '12:00',
          format: 'post',
          pillar: 'p',
          idea: 'old',
          done: true,
        },
      ],
    };
    const serverCalendar = {
      ...localCalendar,
      startedOn: '2026-10-20',
      items: [{ ...localCalendar.items[0], date: '2026-10-21', idea: 'new', done: false }],
    };
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(localCalendar));
    localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify({ version: 2, dirty: true }));
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 5,
      data: { calendar: serverCalendar },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: stateUrl }));
    expect(put.request.body).toEqual({
      baseVersion: 5,
      data: {
        calendar: { ...serverCalendar, items: [{ ...serverCalendar.items[0], done: true }] },
      },
    });
    put.flush({ version: 6, data: {}, updatedAt: '2026-10-19T10:00:05Z' });

    await vi.waitFor(() => expect(meta()).toEqual({ version: 6, dirty: false }));
    expect(JSON.parse(localStorage.getItem(CALENDAR_STORAGE_KEY) ?? '{}')).toMatchObject({
      startedOn: '2026-10-20',
    });
    expect(JSON.parse(localStorage.getItem(SYNC_BACKUP_STORAGE_KEY) ?? '{}')).toMatchObject({
      calendar: { startedOn: '2026-10-13' },
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('remembers an edit made before the server answered who is signed in', async () => {
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http.expectOne(meUrl).flush({ error: 'нет связи' }, { status: 0, statusText: 'offline' });
    await vi.waitFor(() => expect(account.signedIn()).toBe(false));

    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();

    expect(meta()).toEqual({ version: 0, dirty: true });
    expect(sync.status()).toBe('idle');
  });

  it('does not start a second save while one is in flight', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();
    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    const first = http.expectOne({ method: 'PUT', url: stateUrl });

    sync.flush();
    const settled = sync.settle();
    await vi.advanceTimersByTimeAsync(1);

    http.expectNone({ method: 'PUT', url: stateUrl });
    first.flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toBe(true);
    http.expectNone({ method: 'PUT', url: stateUrl });
  });

  it('does not bother the server when nothing really changed', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();
    TestBed.inject(Settings).setTheme('dark');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    http
      .expectOne({ method: 'PUT', url: stateUrl })
      .flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
    await vi.advanceTimersByTimeAsync(1);

    TestBed.inject(CalendarPlan).items.update((items) => [...items]);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);

    http.expectNone({ method: 'PUT', url: stateUrl });
    expect(meta()).toEqual({ version: 1, dirty: false });
    expect(sync.status()).toBe('ok');
  });
});
