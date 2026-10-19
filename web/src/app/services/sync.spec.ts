import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_ME_PATH,
  API_STATE_PATH,
  CHAT_HISTORY_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
  SYNC_BACKUP_STORAGE_KEY,
  SYNC_META_STORAGE_KEY,
  SYNC_PUSH_DELAY_MS,
} from '../constants';
import { Access } from './access';
import { Account } from './account';
import { Chat } from './chat';
import { Onboarding } from './onboarding';
import { PAGE_RELOAD } from './page-reload';
import { Sync } from './sync';

const meUrl = `${API_DEV_URL}${API_ME_PATH}`;
const stateUrl = `${API_DEV_URL}${API_STATE_PATH}`;

const remoteOnboarding = { index: 4, answers: { specialty: 'маникюр' }, confirmed: false };

describe('Sync', () => {
  let http: HttpTestingController;
  let reload: ReturnType<typeof vi.fn>;
  let sync: Sync;
  let account: Account;

  function meta(): { version: number; dirty: boolean } | undefined {
    const raw = localStorage.getItem(SYNC_META_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { version: number; dirty: boolean }) : undefined;
  }

  async function signIn(role: 'master' | 'admin' = 'master'): Promise<void> {
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http
      .expectOne(meUrl)
      .flush({ role, name: 'Анна', dailyLimit: 80, usageToday: 0, retentionDays: 1095 });
    await vi.waitFor(() => expect(account.role()).toBe(role));
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

  it('does nothing for the owner', async () => {
    await signIn('admin');

    http.expectNone(stateUrl);
    expect(sync.status()).toBe('off');
  });

  it('loads the saved data on a new phone and reloads the page', async () => {
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 3,
      data: { onboarding: remoteOnboarding, strategy: { summary: 'Ок' } },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')).toEqual(
      remoteOnboarding,
    );
    expect(JSON.parse(localStorage.getItem(STRATEGY_STORAGE_KEY) ?? '{}')).toEqual({
      summary: 'Ок',
    });
    expect(meta()).toEqual({ version: 3, dirty: false });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SYNC_BACKUP_STORAGE_KEY)).toBeNull();
  });

  it('drops the chat made before the data arrived so the chat starts from the restored state', async () => {
    localStorage.setItem(
      CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { id: 'x', role: 'assistant', text: 'старое', createdAt: '2026-10-19T10:00:00Z' },
      ]),
    );
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 2,
      data: { onboarding: remoteOnboarding },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it('keeps the chat when nothing changed on the server', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(remoteOnboarding));
    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, '[]');
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 5,
      data: { onboarding: remoteOnboarding, chat: [] },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY)).toBe('[]');
  });

  it('keeps a backup of different local data before taking the server copy', async () => {
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ index: 1, answers: { name: 'Вера' } }),
    );
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 2,
      data: { onboarding: remoteOnboarding },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(JSON.parse(localStorage.getItem(SYNC_BACKUP_STORAGE_KEY) ?? '{}')).toMatchObject({
      onboarding: { index: 1, answers: { name: 'Вера' } },
    });
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '{}')).toEqual(
      remoteOnboarding,
    );
  });

  it('does not reload when the server copy equals the local one', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(remoteOnboarding));
    await signIn();

    http.expectOne(stateUrl).flush({
      version: 5,
      data: {
        onboarding: remoteOnboarding,
        chat: JSON.parse(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) ?? 'null'),
      },
      updatedAt: '2026-10-19T10:00:00Z',
    });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));

    expect(reload).not.toHaveBeenCalled();
    expect(meta()).toEqual({ version: 5, dirty: false });
  });

  it('uploads local data when the server has none', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(remoteOnboarding));
    await signIn();

    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    const put = await vi.waitFor(() => http.expectOne({ method: 'PUT', url: stateUrl }));
    expect(put.request.body).toMatchObject({
      baseVersion: 0,
      data: { onboarding: remoteOnboarding },
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

  it('saves a change after a short pause and remembers the new version', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();

    TestBed.inject(Onboarding).answer('Анна');
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
    const onboarding = TestBed.inject(Onboarding);

    onboarding.answer('Анна');
    TestBed.tick();
    onboarding.answer('маникюр');
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

    TestBed.inject(Onboarding).answer('Анна');
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

    TestBed.inject(Onboarding).answer('Анна');
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
    const onboarding = TestBed.inject(Onboarding);
    onboarding.answer('Анна');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    const first = http.expectOne({ method: 'PUT', url: stateUrl });

    onboarding.answer('маникюр');
    TestBed.tick();
    first.flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
    await vi.advanceTimersByTimeAsync(1);

    expect(meta()).toEqual({ version: 1, dirty: true });
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    const second = http.expectOne({ method: 'PUT', url: stateUrl });
    expect((second.request.body as { baseVersion: number }).baseVersion).toBe(1);
    second.flush({ version: 2, data: {}, updatedAt: '2026-10-19T10:00:10Z' });
  });

  it('sends the chat history together with the rest of the data', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();

    TestBed.inject(Onboarding).answer('Анна');
    TestBed.inject(Chat).clear();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);

    const put = http.expectOne({ method: 'PUT', url: stateUrl });
    const data = (put.request.body as { data: { chat?: { text: string }[] } }).data;
    expect(Array.isArray(data.chat)).toBe(true);
    expect(data.chat?.length).toBeGreaterThan(0);
    put.flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
  });

  it('does not bother the server when nothing really changed', async () => {
    await signIn();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(sync.status()).toBe('ok'));
    vi.useFakeTimers();
    TestBed.inject(Onboarding).answer('Анна');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);
    http
      .expectOne({ method: 'PUT', url: stateUrl })
      .flush({ version: 1, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
    await vi.advanceTimersByTimeAsync(1);

    TestBed.inject(Chat).messages.update((messages) => [...messages]);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(SYNC_PUSH_DELAY_MS + 10);

    http.expectNone({ method: 'PUT', url: stateUrl });
    expect(meta()).toEqual({ version: 1, dirty: false });
    expect(sync.status()).toBe('ok');
  });
});
