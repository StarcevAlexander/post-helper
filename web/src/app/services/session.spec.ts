import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ACCESS_PASSWORD_STORAGE_KEY,
  API_DEV_URL,
  API_ME_PATH,
  API_STATE_PATH,
  CALENDAR_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
  SYNC_META_STORAGE_KEY,
} from '../constants';
import { Access } from './access';
import { Account } from './account';
import { PAGE_RELOAD } from './page-reload';
import { Session } from './session';
import { Sync } from './sync';

const meUrl = `${API_DEV_URL}${API_ME_PATH}`;
const stateUrl = `${API_DEV_URL}${API_STATE_PATH}`;

describe('Session', () => {
  let http: HttpTestingController;
  let reload: ReturnType<typeof vi.fn>;
  let access: Access;
  let account: Account;
  let session: Session;

  async function signIn(): Promise<void> {
    access.save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http.expectOne(meUrl).flush({ name: 'Анна', retentionDays: 1095 });
    await vi.waitFor(() => expect(account.signedIn()).toBe(true));
    TestBed.tick();
    http.expectOne(stateUrl).flush({ version: 0, data: null, updatedAt: '' });
    await vi.waitFor(() => expect(TestBed.inject(Sync).status()).toBe('ok'));
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
    access = TestBed.inject(Access);
    account = TestBed.inject(Account);
    session = TestBed.inject(Session);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('forgets the person and their data but keeps the look of the app', async () => {
    await signIn();
    localStorage.setItem(STRATEGY_STORAGE_KEY, '{"index":1}');
    localStorage.setItem(CALENDAR_STORAGE_KEY, '{"items":[]}');
    localStorage.setItem(SYNC_META_STORAGE_KEY, '{"version":1,"dirty":false}');
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{"theme":"dark","scale":120}');
    localStorage.setItem('other.key', 'stays');

    await expect(session.logout()).resolves.toBe(true);

    expect(access.granted()).toBe(false);
    expect(localStorage.getItem(ACCESS_PASSWORD_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STRATEGY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CALENDAR_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SYNC_META_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe('{"theme":"dark","scale":120}');
    expect(localStorage.getItem('other.key')).toBe('stays');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays signed in when the unsaved data could not reach the server', async () => {
    await signIn();
    localStorage.setItem(STRATEGY_STORAGE_KEY, '{"index":1}');
    localStorage.setItem(SYNC_META_STORAGE_KEY, '{"version":0,"dirty":true}');

    const loggedOut = session.logout();
    http
      .expectOne({ method: 'PUT', url: stateUrl })
      .flush({ error: 'сбой' }, { status: 500, statusText: 'Server Error' });

    await expect(loggedOut).resolves.toBe(false);
    expect(access.granted()).toBe(true);
    expect(localStorage.getItem(STRATEGY_STORAGE_KEY)).toBe('{"index":1}');
    expect(reload).not.toHaveBeenCalled();
  });
});
