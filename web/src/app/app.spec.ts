import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { ACCESS_PASSWORD_STORAGE_KEY, ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY } from './constants';

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

  it('renders a plain welcome without questions once the password is stored', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-access-gate')).toBeNull();
    expect(element.querySelectorAll('app-message-bubble').length).toBe(1);
    expect(element.querySelector('.shell__strategy')).toBeNull();
    expect(element.querySelector('app-composer')).toBeTruthy();
  });

  it('renders the introduction with the first question once the user has started', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ index: 0, answers: {}, started: true }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('app-message-bubble').length).toBe(2);
    expect(element.querySelector('.shell__strategy')).toBeNull();
    expect(element.querySelector('app-composer')).toBeTruthy();
  });

  it('shows the strategy button once the profile is complete', async () => {
    localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, 'stored-pass');
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр' },
        confirmed: true,
      }),
    );
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.shell__strategy')).toBeTruthy();
    expect(element.querySelectorAll('app-message-bubble').length).toBe(1);
  });
});
