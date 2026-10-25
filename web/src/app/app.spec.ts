import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { routes } from './app.routes';
import { ACCESS_PASSWORD_STORAGE_KEY, CALENDAR_STORAGE_KEY } from './constants';

const calendar = {
  schedule: { slots: [{ weekday: 3, time: '18:00' }], publishTime: '19:00' },
  items: [
    {
      id: 'w1',
      date: '2026-10-21',
      time: '19:00',
      format: 'post',
      pillar: 'До и после',
      idea: 'Кадр до',
      done: false,
    },
  ],
  startedOn: '2026-10-20',
};

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function start() {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows only the sign-in gate to a stranger', async () => {
    const { element } = await start();

    expect(element.querySelector('h1')?.textContent).toContain('Помощник');
    expect(element.querySelector('app-access-gate')).toBeTruthy();
    expect(element.querySelector('nav.tabs')).toBeNull();
  });

  it('does not let a stranger open a screen by its address', async () => {
    await start();

    await TestBed.inject(Router).navigateByUrl('/today');

    expect(TestBed.inject(Router).url).not.toContain('today');
  });

  it('opens the request while there is no plan', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');

    const { element } = await start();

    expect(TestBed.inject(Router).url).toBe('/intake');
    expect(element.querySelector('app-access-gate')).toBeNull();
    expect(element.querySelector('h1')?.textContent).toContain('Контент-план для вас');
    expect(element.querySelector('app-intake-screen')).toBeTruthy();
  });

  it('opens today once the plan has arrived and offers five tabs', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendar));

    const { element } = await start();

    expect(TestBed.inject(Router).url).toBe('/today');
    const tabs = Array.from(element.querySelectorAll('nav.tabs .tab'));
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Сегодня',
      'Календарь',
      'Итоги',
      'Профиль',
      'Заявка',
    ]);
    expect(element.querySelector('.tab--active')?.textContent).toContain('Сегодня');
    expect(element.querySelector('.shell__back')).toBeNull();
  });

  it('shows a way back on the screens that are not tabs', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendar));
    const { fixture, element } = await start();

    await TestBed.inject(Router).navigateByUrl('/settings');
    await fixture.whenStable();

    expect(element.querySelector('h1')?.textContent).toContain('Настройки');
    expect(element.querySelector('.shell__back')).toBeTruthy();
  });
});
