import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_ME_PATH } from '../../constants';
import { Access } from '../../services/access';
import { AccountInfo } from '../../models';
import { Account } from '../../services/account';
import { SettingsPanel } from './settings-panel';

describe('SettingsPanel account block', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function render(info: AccountInfo | undefined) {
    const fixture = TestBed.createComponent(SettingsPanel);
    const account = TestBed.inject(Account);
    await fixture.whenStable();
    account.info.set(info);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows nothing about the account before the person is known', async () => {
    const element = await render(undefined);

    expect(element.querySelector('.account')).toBeNull();
  });

  it('shows the master name and how long the data is kept', async () => {
    const element = await render({
      role: 'master',
      name: 'Анна',
      dailyLimit: 80,
      usageToday: 3,
      retentionDays: 1095,
    });

    expect(element.querySelector('.account')?.textContent).toContain('Анна');
    expect(element.querySelector('.account')?.textContent).not.toContain('из 80');
    expect(element.querySelector('.account')?.textContent).toContain('хранятся 3 года');
    expect(element.textContent).not.toContain('Мастера и расходы');
  });

  it('shows the owner without the limit line and without the masters screen', async () => {
    const element = await render({
      role: 'admin',
      name: 'owner',
      dailyLimit: 80,
      usageToday: 0,
      retentionDays: 1095,
    });

    expect(element.querySelector('.account')?.textContent).toContain('владелец');
    expect(element.querySelector('.account')?.textContent).not.toContain('из 80');
    expect(element.querySelector('.account')?.textContent).not.toContain('хранится');
    expect(element.textContent).not.toContain('Мастера и расходы');
  });

  it('refreshes the daily use of the AI each time the screen is opened', async () => {
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(Account);
    TestBed.tick();
    http.match(`${API_DEV_URL}${API_ME_PATH}`).forEach((request) =>
      request.flush({
        role: 'master',
        name: 'Анна',
        dailyLimit: 80,
        usageToday: 1,
        retentionDays: 1095,
      }),
    );
    await vi.waitFor(() => expect(TestBed.inject(Account).info()?.usageToday).toBe(1));

    const fixture = TestBed.createComponent(SettingsPanel);
    await fixture.whenStable();

    const requests = http.match(`${API_DEV_URL}${API_ME_PATH}`);
    expect(requests.length).toBe(1);
    requests[0].flush({
      role: 'master',
      name: 'Анна',
      dailyLimit: 80,
      usageToday: 7,
      retentionDays: 1095,
    });
    await vi.waitFor(() => expect(TestBed.inject(Account).info()?.usageToday).toBe(7));
  });
});
