import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY } from '../../constants';
import { Onboarding } from '../../services/onboarding';
import { ProfileScreen } from './profile-screen';

describe('ProfileScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр', city: 'Иркутск' },
        confirmed: false,
      }),
    );
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  function setUp() {
    const fixture = TestBed.createComponent(ProfileScreen);
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, element };
  }

  function type(element: HTMLElement, field: string, value: string): void {
    const input = element.querySelector<HTMLTextAreaElement>(`#profile-${field}`);
    if (!input) {
      throw new Error(`no field ${field}`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('shows every question with the stored answer', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    expect(element.querySelectorAll('textarea').length).toBe(ONBOARDING_STEPS.length);
    expect(element.querySelector<HTMLTextAreaElement>('#profile-city')?.value).toBe('Иркутск');
  });

  it('can be confirmed as it is', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('flags a garbage answer and blocks the confirmation', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    type(element, 'goal', 'ыыыыыы');
    await fixture.whenStable();

    expect(element.querySelector('#profile-error-goal')?.textContent).toContain('например');
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('does not allow clearing the required question', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    type(element, 'specialty', '');
    await fixture.whenStable();

    expect(element.querySelector('#profile-error-specialty')).toBeTruthy();
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('saves the corrected answers and confirms the profile', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const onboarding = TestBed.inject(Onboarding);

    type(element, 'city', 'Ангарск');
    await fixture.whenStable();
    element.querySelector<HTMLFormElement>('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(onboarding.answers().city).toBe('Ангарск');
    expect(onboarding.confirmed()).toBe(true);
  });
});
