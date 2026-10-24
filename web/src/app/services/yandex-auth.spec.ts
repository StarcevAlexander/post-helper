import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ACCESS_PASSWORD_STORAGE_KEY,
  API_AUTH_CONFIG_PATH,
  API_AUTH_YANDEX_PATH,
  API_DEV_URL,
  API_ME_PATH,
  API_ME_YANDEX_PATH,
  OAUTH_STATE_STORAGE_KEY,
  YANDEX_TEXTS,
} from '../constants';
import { Access } from './access';
import { PAGE_NAVIGATE } from './page-navigate';
import { YandexAuth } from './yandex-auth';

const configUrl = `${API_DEV_URL}${API_AUTH_CONFIG_PATH}`;
const loginUrl = `${API_DEV_URL}${API_AUTH_YANDEX_PATH}`;
const linkUrl = `${API_DEV_URL}${API_ME_YANDEX_PATH}`;
const meUrl = `${API_DEV_URL}${API_ME_PATH}`;

describe('YandexAuth', () => {
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.fn>;
  let service: YandexAuth;

  function comeBackFromYandex(query: string): void {
    window.history.replaceState(null, '', `/${query}`);
  }

  function pending(state: string, mode: 'login' | 'link'): void {
    localStorage.setItem(OAUTH_STATE_STORAGE_KEY, JSON.stringify({ state, mode }));
  }

  beforeEach(async () => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PAGE_NAVIGATE, useValue: navigate },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(YandexAuth);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  async function configured(): Promise<void> {
    const loaded = service.loadConfig();
    http.expectOne(configUrl).flush({ yandexClientId: 'app-id' });
    await loaded;
  }

  it('is unavailable until the server says Yandex is on', async () => {
    expect(service.available()).toBe(false);

    const loaded = service.loadConfig();
    http.expectOne(configUrl).flush({ yandexClientId: '' });
    await loaded;

    expect(service.available()).toBe(false);
  });

  it('stays unavailable when the config cannot be loaded', async () => {
    const loaded = service.loadConfig();
    http.expectOne(configUrl).flush({}, { status: 500, statusText: 'Server Error' });
    await loaded;

    expect(service.available()).toBe(false);
  });

  it('is available at once when the id was cached by an earlier visit', async () => {
    await configured();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    expect(TestBed.inject(YandexAuth).available()).toBe(true);
  });

  it('keeps the cached id when the config cannot be loaded', async () => {
    await configured();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const next = TestBed.inject(YandexAuth);
    const loaded = next.loadConfig();
    TestBed.inject(HttpTestingController)
      .expectOne(configUrl)
      .flush({}, { status: 500, statusText: 'Server Error' });
    await loaded;

    expect(next.available()).toBe(true);
  });

  it('sends the person to Yandex and remembers why', async () => {
    await configured();

    service.begin('login');

    expect(navigate).toHaveBeenCalledTimes(1);
    const url = new URL(navigate.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://oauth.yandex.ru/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('app-id');
    expect(url.searchParams.get('redirect_uri')).toBe(document.baseURI.split(/[?#]/)[0]);
    const state = url.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(localStorage.getItem(OAUTH_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      state,
      mode: 'login',
    });
  });

  it('does nothing when Yandex is not available', () => {
    service.begin('login');

    expect(navigate).not.toHaveBeenCalled();
  });

  it('signs in with the code that came back and cleans the address', async () => {
    pending('s1', 'login');
    comeBackFromYandex('?code=abc&state=s1&keep=1');

    const done = service.completeFromUrl();
    const request = http.expectOne(loginUrl);
    expect(request.request.body).toEqual({
      code: 'abc',
      redirectUri: document.baseURI.split(/[?#]/)[0],
    });
    request.flush({ token: 'NEW-TOKEN', name: 'Анна' });
    await done;

    expect(TestBed.inject(Access).password()).toBe('NEW-TOKEN');
    expect(localStorage.getItem(ACCESS_PASSWORD_STORAGE_KEY)).toBe('NEW-TOKEN');
    expect(localStorage.getItem(OAUTH_STATE_STORAGE_KEY)).toBeNull();
    expect(window.location.search).toBe('?keep=1');
    expect(service.notice()).toBe('');
    TestBed.tick();
    http.expectOne(meUrl);
  });

  it('ignores a callback it did not ask for', async () => {
    pending('mine', 'login');
    comeBackFromYandex('?code=abc&state=forged');

    await service.completeFromUrl();

    http.expectNone(loginUrl);
    expect(TestBed.inject(Access).granted()).toBe(false);
    expect(window.location.search).toBe('?code=abc&state=forged');
  });

  it('ignores a callback when nothing was asked', async () => {
    comeBackFromYandex('?code=abc&state=s1');

    await service.completeFromUrl();

    http.expectNone(loginUrl);
  });

  it('says so when the person refused at Yandex', async () => {
    pending('s1', 'login');
    comeBackFromYandex('?error=access_denied&state=s1');

    await service.completeFromUrl();

    http.expectNone(loginUrl);
    expect(service.notice()).toBe(YANDEX_TEXTS.denied);
    expect(window.location.search).toBe('');
  });

  it('shows the server message when sign-in is refused', async () => {
    pending('s1', 'login');
    comeBackFromYandex('?code=abc&state=s1');

    const done = service.completeFromUrl();
    http
      .expectOne(loginUrl)
      .flush({ error: 'Яндекс не подтвердил вход' }, { status: 403, statusText: 'Forbidden' });
    await done;

    expect(service.notice()).toBe('Яндекс не подтвердил вход');
    expect(TestBed.inject(Access).granted()).toBe(false);
    expect(service.busy()).toBe(false);
  });

  it('links Yandex to the signed-in master and reloads who they are', async () => {
    const info = { name: 'Анна', retentionDays: 1095 };
    TestBed.inject(Access).save('MASTER-PASSWORD');
    TestBed.tick();
    http.expectOne(meUrl).flush(info);
    pending('s2', 'link');
    comeBackFromYandex('?code=zzz&state=s2');

    const done = service.completeFromUrl();
    const request = http.expectOne(linkUrl);
    expect(request.request.headers.get('Authorization')).toBe('Bearer MASTER-PASSWORD');
    request.flush({ providers: ['yandex'] });
    await vi.waitFor(() => {
      const refreshes = http.match(meUrl);
      expect(refreshes).toHaveLength(1);
      refreshes[0].flush({ ...info, providers: ['yandex'] });
    });
    await done;

    expect(service.notice()).toBe(YANDEX_TEXTS.linkedDone);
    expect(service.linked()).toBe(true);
  });
});
