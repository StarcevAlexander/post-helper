import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { ACCESS_PASSWORD_STORAGE_KEY } from './constants';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('asks for the password before showing the composer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Помощник');
    expect(element.querySelector('app-access-gate')).toBeTruthy();
    expect(element.querySelector('app-composer')).toBeNull();
  });

  it('renders the welcome message and the settings toggle once the password is stored', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-access-gate')).toBeNull();
    expect(element.querySelectorAll('app-message-bubble').length).toBe(1);
    expect(element.querySelector('app-composer')).toBeTruthy();
  });
});
