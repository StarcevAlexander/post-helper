import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicationKit, ScheduleDraft, Strategy } from '../../models';
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

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    plan = TestBed.inject(CalendarPlan);
    kits = TestBed.inject(Kits);
    today = TestBed.inject(Today);
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
    await fixture.whenStable();
    return { item, fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('explains that there is no calendar yet', async () => {
    const fixture = TestBed.createComponent(TodayScreen);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Плана пока нет');
  });

  it('shows the publication of the day and says the kit is still to come', async () => {
    const { item, element } = await openOnFirstPublication();

    expect(element.textContent).toContain(item.idea);
    expect(element.textContent).toContain('скоро появится');
    expect(element.querySelector('.entry__copy')).toBeNull();
  });

  it('copies the caption with hashtags once the kit is ready', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { item, fixture, element } = await openOnFirstPublication();
    kits.stored.set({
      [item.id]: {
        itemId: item.id,
        format: item.format,
        pillar: item.pillar,
        idea: item.idea,
        kit,
      },
    });
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

  it('links to the calendar', async () => {
    const { element } = await openOnFirstPublication();

    const links = element.querySelectorAll<HTMLAnchorElement>('a.screen__secondary');

    expect(links[links.length - 1].getAttribute('href')).toBe('/calendar');
  });

  it('offers the shooting list for the week on a content day', async () => {
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
    const [year, month, day] = plan.weeks()[0].contentDays[0].date.split('-').map(Number);
    vi.setSystemTime(new Date(year, month - 1, day, 9, 0));
    const fixture = TestBed.createComponent(TodayScreen);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.shoot')?.textContent).toContain('Сегодня день контента');
    expect(element.querySelector('.shoot a')?.getAttribute('href')).toBe('/shoot/0');
  });

  it('does not show the shooting card on an ordinary day', async () => {
    const { element } = await openOnFirstPublication();

    expect(element.querySelector('.shoot')).toBeNull();
  });
});
