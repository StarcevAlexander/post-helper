import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_KIT_PATH,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
} from '../../constants';
import { PublicationKit, ScheduleDraft, Strategy } from '../../models';
import { Access } from '../../services/access';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Today } from '../../services/today';
import { TodayScreen } from './today-screen';

const strategy: Strategy = {
  summary: 'Ок',
  positioning: 'Аккуратный маникюр',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
  ],
  cadence: { reels: 1, posts: 1, stories: 1, note: '' },
  firstSteps: [],
};

const draft: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: '19:00',
};

const kit: PublicationKit = {
  shots: ['Снять руки крупно'],
  frames: [{ visual: 'Руки с гель-лаком', overlay: 'Смотрите' }],
  caption: 'Показываю маникюр.',
  hashtags: ['#маникюр', '#иркутск'],
  tip: 'Спросите согласие клиента',
};

describe('TodayScreen', () => {
  let plan: CalendarPlan;
  let kits: Kits;
  let today: Today;
  let http: HttpTestingController;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    vi.useFakeTimers({ toFake: ['Date'] });
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
    plan = TestBed.inject(CalendarPlan);
    kits = TestBed.inject(Kits);
    today = TestBed.inject(Today);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('secret-pass');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function openOnFirstPublication() {
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
    const item = [...plan.items()].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    const [year, month, day] = item.date.split('-').map(Number);
    vi.setSystemTime(new Date(year, month - 1, day, 9, 0));
    const fixture = TestBed.createComponent(TodayScreen);
    today.show();
    await fixture.whenStable();
    return { item, fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('explains that there is no calendar yet', async () => {
    const fixture = TestBed.createComponent(TodayScreen);
    today.show();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Календаря пока нет');
  });

  it('shows the publication of the day with a way to prepare its kit', async () => {
    const { item, element } = await openOnFirstPublication();

    expect(element.textContent).toContain(item.idea);
    expect(element.textContent).toContain('Подготовить комплект');
    expect(element.querySelector('.entry__copy')).toBeNull();
  });

  it('copies the caption with hashtags once the kit is ready', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { item, fixture, element } = await openOnFirstPublication();
    const pending = kits.generate(item);
    http.expectOne(`${API_DEV_URL}${API_KIT_PATH}`).flush(kit);
    await pending;
    await fixture.whenStable();

    element.querySelector<HTMLButtonElement>('.entry__copy')?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('Показываю маникюр.\n\n#маникюр #иркутск');
    expect(element.querySelector('.entry__feedback')?.textContent).toContain('скопировано');
  });

  it('marks the publication as done', async () => {
    const { item, fixture, element } = await openOnFirstPublication();

    element.querySelector<HTMLInputElement>('.entry__check')?.click();
    await fixture.whenStable();

    expect(plan.items().find((candidate) => candidate.id === item.id)?.done).toBe(true);
    expect(element.querySelector('.entry--done')).not.toBeNull();
  });

  it('closes by clearing the open flag', async () => {
    const { fixture, element } = await openOnFirstPublication();

    element.querySelector<HTMLButtonElement>('.screen__close')?.click();
    await fixture.whenStable();

    expect(today.open()).toBe(false);
  });

  it('hands over to the calendar', async () => {
    const { fixture, element } = await openOnFirstPublication();
    let requested = 0;
    fixture.componentInstance.calendarRequested.subscribe(() => (requested += 1));

    const buttons = element.querySelectorAll<HTMLButtonElement>('.screen__secondary');
    buttons[buttons.length - 1].click();
    await fixture.whenStable();

    expect(requested).toBe(1);
    expect(today.open()).toBe(false);
  });
});
