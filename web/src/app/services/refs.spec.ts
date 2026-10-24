import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_REFS_FILES_PATH,
  API_REFS_MADE_PATH,
  API_REFS_ORDER_PATH,
  API_REFS_STATUS_PATH,
  CALENDAR_STORAGE_KEY,
  REFS_ORDER_DELAY_MS,
  REFS_POLL_MS,
} from '../constants';
import { RefStatus, StoredCalendar } from '../models';
import { Access } from './access';
import { Refs } from './refs';

const orderUrl = `${API_DEV_URL}${API_REFS_ORDER_PATH}`;
const statusUrl = `${API_DEV_URL}${API_REFS_STATUS_PATH}`;
const madeUrl = `${API_DEV_URL}${API_REFS_MADE_PATH}`;
const fileUrl = (id: string) => `${API_DEV_URL}${API_REFS_FILES_PATH}/${id}`;
const meUrl = `${API_DEV_URL}/api/me`;

const calendar: StoredCalendar = {
  schedule: { slots: [{ weekday: 1, time: '12:00' }], publishTime: '18:00' },
  startedOn: '2026-10-20',
  items: [
    {
      id: 'w1-mon',
      date: '2026-10-20',
      time: '18:00',
      format: 'reels',
      pillar: 'Процесс',
      idea: 'Видео снятия гель-лака',
      done: false,
    },
    {
      id: 'w1-wed',
      date: '2026-10-22',
      time: '18:00',
      format: 'post',
      pillar: 'До и после',
      idea: 'Кадр рук до и после',
      done: false,
    },
  ],
};

function status(overrides: Partial<RefStatus> = {}): RefStatus {
  return { key: 'w1-mon', status: 'queued', kind: 'photo', stale: false, files: [], ...overrides };
}

describe('Refs', () => {
  let refs: Refs;
  let http: HttpTestingController;

  async function signIn(): Promise<void> {
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http.expectOne({ method: 'GET', url: meUrl }).flush({ name: 'Анна', retentionDays: 1095 });
    await vi.waitFor(() => {
      TestBed.tick();
    });
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendar));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    refs = TestBed.inject(Refs);
  });

  afterEach(() => {
    refs.stop();
    http.verify();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('orders the references for the whole plan once the master is known', async () => {
    await signIn();

    await vi.advanceTimersByTimeAsync(REFS_ORDER_DELAY_MS);
    const order = http.expectOne({ method: 'POST', url: orderUrl });

    expect(order.request.body).toEqual({
      items: [
        {
          key: 'w1-mon',
          format: 'reels',
          pillar: 'Процесс',
          idea: 'Видео снятия гель-лака',
          date: '2026-10-20',
        },
        {
          key: 'w1-wed',
          format: 'post',
          pillar: 'До и после',
          idea: 'Кадр рук до и после',
          date: '2026-10-22',
        },
      ],
    });
    order.flush({ added: 2, removed: 0 });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne({ method: 'GET', url: statusUrl }).flush([status()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(refs.byKey().get('w1-mon')?.status).toBe('queued');
    expect(refs.active()).toBe(true);
  });

  it('asks again later while something is being made and stops when it is done', async () => {
    const first = refs.refresh();
    http.expectOne({ method: 'GET', url: statusUrl }).flush([status({ status: 'running' })]);
    await first;

    await vi.advanceTimersByTimeAsync(REFS_POLL_MS);
    http
      .expectOne({ method: 'GET', url: statusUrl })
      .flush([status({ status: 'done', files: [] })]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(REFS_POLL_MS * 3);

    expect(refs.active()).toBe(false);
  });

  it('knows that new references wait for an overdue confirmation', async () => {
    const pending = refs.refresh();
    http
      .expectOne({ method: 'GET', url: statusUrl })
      .flush([
        status({ status: 'done', stale: true }),
        status({ key: 'w1-wed', status: 'queued' }),
      ]);
    await pending;

    expect(refs.blocked()).toBe(true);
  });

  it('loads a file once and keeps its address', async () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:ref'), revokeObjectURL: vi.fn() }),
    );
    const file = {
      id: 'f1',
      index: 0,
      kind: 'photo' as const,
      mediaType: 'image/jpeg',
      caption: 'Руки',
      size: 3,
    };

    const first = refs.urlFor(file);
    const second = refs.urlFor(file);
    const request = http.expectOne({ method: 'GET', url: fileUrl('f1') });
    expect(request.request.headers.get('Authorization')).toMatch(/^Bearer /);
    request.flush(new Blob([new Uint8Array([1, 2, 3])]));

    expect(await first).toBe('blob:ref');
    expect(await second).toBe('blob:ref');
  });

  it('confirms the content as made, frees the files and reloads the statuses', async () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:ref'), revokeObjectURL: revoke }),
    );
    const file = {
      id: 'f1',
      index: 0,
      kind: 'photo' as const,
      mediaType: 'image/jpeg',
      caption: '',
      size: 3,
    };
    const loaded = refs.refresh();
    http
      .expectOne({ method: 'GET', url: statusUrl })
      .flush([status({ status: 'done', files: [file] })]);
    await loaded;
    const url = refs.urlFor(file);
    http.expectOne({ method: 'GET', url: fileUrl('f1') }).flush(new Blob([new Uint8Array([1])]));
    await url;

    const pending = refs.confirmMade('w1-mon');
    const request = http.expectOne({ method: 'POST', url: madeUrl });
    expect(request.request.body).toEqual({ key: 'w1-mon' });
    request.flush({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne({ method: 'GET', url: statusUrl }).flush([status({ status: 'made' })]);

    expect(await pending).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(revoke).toHaveBeenCalledWith('blob:ref');
    expect(refs.byKey().get('w1-mon')?.status).toBe('made');
  });

  it('shows the server message when the confirmation is refused', async () => {
    const pending = refs.confirmMade('w1-mon');
    http
      .expectOne({ method: 'POST', url: madeUrl })
      .flush({ error: 'Референсы сейчас делаются' }, { status: 409, statusText: 'Conflict' });

    expect(await pending).toBe(false);
    expect(refs.error()).toBe('Референсы сейчас делаются');
  });
});
