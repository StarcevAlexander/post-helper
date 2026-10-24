import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_DEV_URL, API_ME_NAME_PATH, API_ME_PATH } from '../constants';
import { Access } from './access';
import { Account } from './account';

const meUrl = `${API_DEV_URL}${API_ME_PATH}`;

describe('Account', () => {
  let http: HttpTestingController;
  let access: Access;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    access = TestBed.inject(Access);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('asks nothing while there is no code', () => {
    const account = TestBed.inject(Account);
    TestBed.tick();

    http.expectNone(meUrl);
    expect(account.info()).toBeUndefined();
    expect(account.role()).toBeUndefined();
  });

  it('loads who is signed in as soon as a code is saved', () => {
    const account = TestBed.inject(Account);
    access.save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();

    const request = http.expectOne(meUrl);
    expect(request.request.headers.get('Authorization')).toBe('Bearer ABCDE-FGHJK-LMNPQ-RSTUV');
    request.flush({
      role: 'master',
      name: 'Анна',
      dailyLimit: 80,
      usageToday: 3,
      retentionDays: 1095,
    });

    return vi
      .waitFor(() => expect(account.role()).toBe('master'))
      .then(() => {
        expect(account.info()?.name).toBe('Анна');
        expect(account.info()?.usageToday).toBe(3);
      });
  });

  it('recognizes the owner', async () => {
    const account = TestBed.inject(Account);
    access.save('owner-secret-1');
    TestBed.tick();

    http
      .expectOne(meUrl)
      .flush({ role: 'admin', name: 'owner', dailyLimit: 80, usageToday: 0, retentionDays: 1095 });

    await vi.waitFor(() => expect(account.role()).toBe('admin'));
  });

  it('signs out when the server refuses the code', async () => {
    TestBed.inject(Account);
    access.save('wrong');
    TestBed.tick();

    http
      .expectOne(meUrl)
      .flush({ error: 'Неверный код' }, { status: 401, statusText: 'Unauthorized' });

    await vi.waitFor(() => expect(access.granted()).toBe(false));
    expect(access.rejected()).toBe(true);
  });

  it('forgets the refusal when a new password is entered', async () => {
    TestBed.inject(Account);
    access.save('wrong');
    TestBed.tick();
    http
      .expectOne(meUrl)
      .flush({ error: 'Неверный код' }, { status: 401, statusText: 'Unauthorized' });
    await vi.waitFor(() => expect(access.rejected()).toBe(true));

    access.save('another');

    expect(access.rejected()).toBe(false);
    TestBed.tick();
    http.expectOne(meUrl);
  });

  it('renames the master and shows the new name', async () => {
    const account = TestBed.inject(Account);
    access.save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http
      .expectOne(meUrl)
      .flush({ role: 'master', name: 'Анна', dailyLimit: 80, usageToday: 0, retentionDays: 1095 });
    await vi.waitFor(() => expect(account.role()).toBe('master'));

    const renamed = account.rename('Мария');
    const request = http.expectOne(`${API_DEV_URL}${API_ME_NAME_PATH}`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Мария' });
    request.flush({ name: 'Мария' });
    await renamed;

    expect(account.info()?.name).toBe('Мария');
  });

  it('keeps the old name when the server refuses the new one', async () => {
    const account = TestBed.inject(Account);
    access.save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http
      .expectOne(meUrl)
      .flush({ role: 'master', name: 'Анна', dailyLimit: 80, usageToday: 0, retentionDays: 1095 });
    await vi.waitFor(() => expect(account.role()).toBe('master'));

    const renamed = account.rename('x');
    http
      .expectOne(`${API_DEV_URL}${API_ME_NAME_PATH}`)
      .flush({ error: 'Имя слишком длинное' }, { status: 400, statusText: 'Bad Request' });

    await expect(renamed).rejects.toThrow('Имя слишком длинное');
    expect(account.info()?.name).toBe('Анна');
  });

  it('forgets the person after the code is removed', async () => {
    const account = TestBed.inject(Account);
    access.save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http
      .expectOne(meUrl)
      .flush({ role: 'master', name: 'Анна', dailyLimit: 80, usageToday: 0, retentionDays: 1095 });
    await vi.waitFor(() => expect(account.role()).toBe('master'));

    access.clear();
    TestBed.tick();

    expect(account.info()).toBeUndefined();
  });
});
