import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_REVIEW_PATH,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
} from '../../constants';
import { ReviewRequest, ReviewResult, ScheduleDraft, Strategy } from '../../models';
import { Access } from '../../services/access';
import { CalendarPlan } from '../../services/calendar-plan';
import { Onboarding } from '../../services/onboarding';
import { Reviews } from '../../services/reviews';
import { ReviewScreen } from './review-screen';

const reviewUrl = `${API_DEV_URL}${API_REVIEW_PATH}`;

const strategy: Strategy = {
  summary: 'Ок',
  positioning: 'Аккуратный маникюр',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
    { title: 'Окошки', description: '', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 1, posts: 1, stories: 3, note: '' },
  firstSteps: [],
};

const draft: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: '19:00',
};

const result: ReviewResult = {
  headline: 'Хороший старт: выполнено 3 из 5',
  whatWorked: ['Сторис с окошками'],
  whatToChange: ['Снимайте пачкой'],
  nextFocus: 'Два Reels',
  cadence: { reels: 2, posts: 1, stories: 4 },
  newIdeas: [{ pillar: 'Окошки', ideas: ['Окошки на выходные'] }],
};

describe('ReviewScreen', () => {
  let reviews: Reviews;
  let plan: CalendarPlan;
  let http: HttpTestingController;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
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
    reviews = TestBed.inject(Reviews);
    plan = TestBed.inject(CalendarPlan);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  async function open() {
    const fixture = TestBed.createComponent(ReviewScreen);
    reviews.view(plan.weeks()[0]);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function fill(element: HTMLElement, id: string, value: string): void {
    const control = element.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(`#${id}`);
    if (!control) {
      throw new Error(`no control ${id}`);
    }
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function submit(element: HTMLElement): HTMLButtonElement {
    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) {
      throw new Error('no submit button');
    }
    return button;
  }

  it('asks three questions and lists the publications of the week', async () => {
    const { element } = await open();

    expect(element.querySelector('#review-inquiries')).toBeTruthy();
    expect(element.querySelector('#review-hard')).toBeTruthy();
    const options = Array.from(element.querySelectorAll('#review-best option')).map((option) =>
      option.textContent?.trim(),
    );
    expect(options[0]).toBe('Не знаю');
    expect(options.length).toBeGreaterThan(2);
    expect(element.querySelector('.screen__subtitle')?.textContent).toContain('–');
  });

  it('rejects a text where a number is expected', async () => {
    const { fixture, element } = await open();

    fill(element, 'review-inquiries', 'много');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.field__error')?.textContent).toContain('число');
    expect(submit(element).disabled).toBe(true);
  });

  it('sends the answers and shows the advice', async () => {
    const { fixture, element } = await open();
    const idea = plan.weeks()[0].items[0].idea;

    fill(element, 'review-inquiries', '5');
    fill(element, 'review-best', idea);
    fill(element, 'review-hard', 'мало времени');
    await fixture.whenStable();
    submit(element).click();
    const request = http.expectOne(reviewUrl);
    expect((request.request.body as ReviewRequest).results).toEqual({
      inquiries: 5,
      bestIdea: idea,
      hard: 'мало времени',
    });
    request.flush(result);
    await vi.waitFor(() => expect(reviews.busy()).toBe(false));
    await fixture.whenStable();
    fixture.detectChanges();

    const text = element.textContent ?? '';
    expect(text).toContain('Хороший старт: выполнено 3 из 5');
    expect(text).toContain('Снимайте пачкой');
    expect(text).toContain('Reels 2 · Пост 1 · Сторис 4');
    expect(text).toContain('Окошки на выходные');
    expect(element.querySelector('form')).toBeNull();
  });

  it('leaves the number out when the master does not know it', async () => {
    const { fixture, element } = await open();

    submit(element).click();
    await fixture.whenStable();

    const request = http.expectOne(reviewUrl);
    expect((request.request.body as ReviewRequest).results).toEqual({ bestIdea: '', hard: '' });
    request.flush(result);
    await vi.waitFor(() => expect(reviews.busy()).toBe(false));
  });

  it('shows the server error and keeps the form', async () => {
    const { fixture, element } = await open();

    submit(element).click();
    http.expectOne(reviewUrl).flush({ error: 'Сбой' }, { status: 502, statusText: 'x' });
    await vi.waitFor(() => expect(reviews.busy()).toBe(false));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.field__error')?.textContent).toContain('Сбой');
    expect(element.querySelector('form')).toBeTruthy();
  });

  it('applies the advice to the calendar and closes', async () => {
    const week = plan.weeks()[0];
    const pending = reviews.submit(week, { bestIdea: '', hard: '' });
    http.expectOne(reviewUrl).flush(result);
    await pending;
    const { fixture, element } = await open();

    element.querySelector<HTMLButtonElement>('.screen__primary')?.click();
    await fixture.whenStable();

    expect(TestBed.inject(Onboarding).strategy()?.cadence.reels).toBe(2);
    expect(reviews.forWeek(week.from)?.applied).toBe(true);
    expect(reviews.viewing()).toBeUndefined();
  });

  it('shows an earlier review first and lets the master redo it', async () => {
    const week = plan.weeks()[0];
    const pending = reviews.submit(week, { bestIdea: '', hard: '' });
    http.expectOne(reviewUrl).flush(result);
    await pending;
    const { fixture, element } = await open();

    expect(element.querySelector('form')).toBeNull();
    element.querySelector<HTMLButtonElement>('.screen__secondary')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('form')).toBeTruthy();
    expect(submit(element).textContent).toContain('заново');
  });

  it('closes by clearing the viewed week', async () => {
    const { fixture, element } = await open();

    element.querySelector<HTMLButtonElement>('.screen__close')?.click();
    await fixture.whenStable();

    expect(reviews.viewing()).toBeUndefined();
  });
});
