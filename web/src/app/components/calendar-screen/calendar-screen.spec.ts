import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, STRATEGY_STORAGE_KEY } from '../../constants';
import { CalendarPlan } from '../../services/calendar-plan';
import { CalendarScreen } from './calendar-screen';

const strategy = {
  summary: 'Ок',
  positioning: '',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
    { title: 'Окошки', description: '', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 1, posts: 1, stories: 2, note: '' },
  firstSteps: [],
};

describe('CalendarScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр' },
        confirmed: true,
      }),
    );
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(strategy));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function setUp() {
    const fixture = TestBed.createComponent(CalendarScreen);
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function change(element: HTMLElement, id: string, value: string): void {
    const control = element.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (!control) {
      throw new Error(`no control ${id}`);
    }
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function submitButton(element: HTMLElement): HTMLButtonElement {
    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) {
      throw new Error('no submit button');
    }
    return button;
  }

  it('offers the default content day and asks to build the calendar', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    expect(element.querySelector<HTMLSelectElement>('#calendar-weekday1')?.value).toBe('3');
    expect(submitButton(element).disabled).toBe(false);
    expect(element.textContent).toContain('Календаря пока нет');
  });

  it('builds the plan and shows weeks with their content day', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    submitButton(element).click();
    await fixture.whenStable();

    expect(TestBed.inject(CalendarPlan).items().length).toBe(16);
    expect(element.querySelectorAll('.week').length).toBe(4);
    expect(element.querySelector('.week__content-day')?.textContent).toContain('18:00');
    expect(element.querySelectorAll('.item').length).toBe(16);
    expect(submitButton(element).textContent).toContain('заново');
  });

  it('rejects a broken time and blocks building', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    change(element, 'calendar-time1', '');
    await fixture.whenStable();

    expect(element.querySelector('.field__error')?.textContent).toContain('время');
    expect(submitButton(element).disabled).toBe(true);
  });

  it('rejects the same weekday twice', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    change(element, 'calendar-weekday2', '3');
    await fixture.whenStable();

    expect(element.querySelector('.field__error')?.textContent).toContain('разные дни');
    expect(submitButton(element).disabled).toBe(true);
  });

  it('marks a publication as done', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    submitButton(element).click();
    await fixture.whenStable();

    element.querySelector<HTMLInputElement>('.item__check')?.click();
    await fixture.whenStable();

    expect(TestBed.inject(CalendarPlan).items()[0].done).toBe(true);
    expect(element.querySelector('.item--done')).toBeTruthy();
  });

  it('downloads the calendar file', async () => {
    const createUrl = vi.fn(() => 'blob:calendar');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { fixture, element } = setUp();
    await fixture.whenStable();
    submitButton(element).click();
    await fixture.whenStable();

    element.querySelector<HTMLButtonElement>('.screen__secondary')?.click();

    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toContain('text/calendar');
    expect(click).toHaveBeenCalledTimes(1);
  });
});
