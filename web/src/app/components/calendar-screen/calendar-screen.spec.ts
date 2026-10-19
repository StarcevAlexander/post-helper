import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ONBOARDING_STEPS, ONBOARDING_STORAGE_KEY, STRATEGY_STORAGE_KEY } from '../../constants';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Refs } from '../../services/refs';
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

    element.querySelector<HTMLButtonElement>('.plan > .screen__secondary')?.click();

    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toContain('text/calendar');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('offers to prepare a kit for every publication and for the whole week', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    submitButton(element).click();
    await fixture.whenStable();

    expect(element.querySelectorAll('.item__kit .item__button').length).toBe(16);
    expect(element.querySelector('.week .screen__secondary')?.textContent).toContain('на неделю');
  });

  it('shows the state of the references next to each publication and warns about overdue ones', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    submitButton(element).click();
    await fixture.whenStable();
    const [first, second, third] = TestBed.inject(CalendarPlan).items();
    TestBed.inject(Refs).statuses.set([
      { key: first.id, status: 'done', kind: 'photo', stale: true, files: [] },
      {
        key: second.id,
        status: 'done',
        kind: 'photo',
        stale: false,
        files: [
          { id: 'a', index: 0, kind: 'photo', mediaType: 'image/jpeg', caption: '', size: 1 },
          { id: 'b', index: 1, kind: 'photo', mediaType: 'image/jpeg', caption: '', size: 1 },
        ],
      },
      { key: third.id, status: 'running', kind: 'photo', stale: false, files: [] },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = element.textContent ?? '';
    expect(text).toContain('Подтвердите, что контент изготовлен');
    expect(text).toContain('Референсы (2)');
    expect(text).toContain('Референсы делаются');
    expect(element.querySelector('.screen__hint--warn')?.textContent).toContain(
      'Новые референсы пока не делаются',
    );
    expect(element.querySelectorAll('.item__button--warn').length).toBe(1);
  });

  it('opens a ready kit and shows the retry after a failure', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    submitButton(element).click();
    await fixture.whenStable();
    const plan = TestBed.inject(CalendarPlan);
    const kits = TestBed.inject(Kits);
    const [first, second] = plan.items();
    kits.stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit: {
          shots: [],
          frames: [{ visual: 'a', overlay: 'b' }],
          caption: 'c',
          hashtags: [],
          tip: '',
        },
      },
    });
    kits.progress.set({ [second.id]: 'failed' });
    kits.errors.set({ [second.id]: 'Сбой' });
    await fixture.whenStable();

    const buttons = element.querySelectorAll<HTMLButtonElement>('.item__kit .item__button');
    expect(buttons[0].textContent).toContain('Открыть комплект');
    expect(buttons[1].textContent).toContain('Повторить');
    expect(element.querySelector('.item__kit .field__error')?.textContent).toContain('Сбой');

    buttons[0].click();
    expect(kits.viewing()).toBe(first.id);
  });
});
