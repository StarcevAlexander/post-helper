import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
import { Media } from '../../services/media';
import { PushNotifications } from '../../services/push-notifications';
import { Reschedule } from '../../services/reschedule';
import { TodayScreen } from './today-screen';

describe('TodayScreen', () => {
  let plan: CalendarPlan;

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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function openOnFirstPublication() {
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    const item = [...plan.items()].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    const [year, month, day] = item.date.split('-').map(Number);
    vi.setSystemTime(new Date(year, month - 1, day, 9, 0));
    const fixture = TestBed.createComponent(TodayScreen);
    await fixture.whenStable();
    return { item, fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('offers to turn on reminders until the master decides', async () => {
    TestBed.resetTestingModule();
    const push = {
      supported: true,
      subscribed: signal(false),
      dismissed: signal(false),
      busy: signal(false),
      notice: signal(''),
      enable: vi.fn(async () => undefined),
      dismiss: vi.fn(() => push.dismissed.set(true)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: PushNotifications, useValue: push },
      ],
    });
    TestBed.inject(CalendarPlan).load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    const fixture = TestBed.createComponent(TodayScreen);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.offer')?.textContent).toContain('Включите напоминания');
    element.querySelector<HTMLButtonElement>('.offer__enable')?.click();
    expect(push.enable).toHaveBeenCalledTimes(1);

    element.querySelector<HTMLButtonElement>('.offer .screen__secondary')?.click();
    await fixture.whenStable();

    expect(push.dismiss).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.offer')).toBeNull();
  });

  it('explains that there is no calendar yet', async () => {
    const fixture = TestBed.createComponent(TodayScreen);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Плана пока нет');
  });

  it('shows the slim publication card that opens the details screen', async () => {
    const { item, element } = await openOnFirstPublication();

    expect(element.textContent).toContain(item.idea);
    expect(element.textContent).not.toContain('скоро появится');
    expect(element.querySelector('.caption__copy')).toBeNull();
    expect(element.querySelector('.entry__move')).toBeNull();
    const link = element.querySelector<HTMLAnchorElement>('a.entry__text');
    expect(link?.getAttribute('href')).toBe(`/item/${item.id}`);
  });

  it('marks the publication as done', async () => {
    const { item, fixture, element } = await openOnFirstPublication();

    element.querySelector<HTMLInputElement>('.entry__check')?.click();
    await fixture.whenStable();

    expect(plan.items().find((candidate) => candidate.id === item.id)?.done).toBe(true);
    expect(element.querySelector('.entry--done')).not.toBeNull();
  });

  it('shows the moved banner with undo after the publication was moved on the details screen', async () => {
    const { item, fixture, element } = await openOnFirstPublication();
    TestBed.inject(Reschedule).move(item.id);
    await fixture.whenStable();

    expect(element.querySelector('.moved')?.textContent).toContain(`«${item.idea}» перенесено на`);

    element.querySelector<HTMLButtonElement>('.moved__undo')?.click();
    await fixture.whenStable();

    expect(element.querySelector('.moved')).toBeNull();
    expect(plan.items().find((candidate) => candidate.id === item.id)?.date).toBe(item.date);
  });

  it('links to the calendar', async () => {
    const { element } = await openOnFirstPublication();

    const links = element.querySelectorAll<HTMLAnchorElement>('a.screen__secondary');

    expect(links[links.length - 1].getAttribute('href')).toBe('/calendar');
  });

  it('offers the shooting list for the week on a content day', async () => {
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
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

  it('tells while the content is being processed and hides it when done', async () => {
    const { item, fixture, element } = await openOnFirstPublication();
    const base = {
      key: item.id,
      unit: '',
      kind: 'video' as const,
      format: item.format,
      error: '',
      createdAt: '2026-10-26T10:00:00Z',
      source: { name: 'a.mov', type: 'video/quicktime', size: 1 },
      redos: 0,
      canRedo: false,
    };
    expect(element.textContent).not.toContain('Контент обрабатывается');

    TestBed.inject(Media).statuses.set([{ ...base, id: 'm1', status: 'running' }]);
    fixture.detectChanges();
    expect(element.textContent).toContain('Контент обрабатывается');
    expect(Array.from(element.querySelectorAll('a')).some((link) =>
      link.textContent?.includes('Готовый контент'),
    )).toBe(false);

    TestBed.inject(Media).statuses.set([{ ...base, id: 'm1', status: 'done' }]);
    fixture.detectChanges();
    expect(element.textContent).not.toContain('Контент обрабатывается');
  });

  it('collapses missed publications behind a toggle', async () => {
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    const items = [...plan.items()].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    );
    const last = items[items.length - 1];
    const [year, month, day] = last.date.split('-').map(Number);
    vi.setSystemTime(new Date(year, month - 1, day, 9, 0));
    const fixture = TestBed.createComponent(TodayScreen);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const missed = items.filter((candidate) => candidate.id !== last.id);
    const toggle = element.querySelector<HTMLButtonElement>('.section__toggle');
    expect(toggle?.textContent).toContain(`Пропущено (${missed.length})`);

    const before = element.querySelectorAll('article.entry').length;
    expect(before).toBeLessThan(missed.length + 1);

    toggle?.click();
    await fixture.whenStable();

    expect(element.querySelectorAll('article.entry').length).toBe(missed.length + 1);
  });
});
