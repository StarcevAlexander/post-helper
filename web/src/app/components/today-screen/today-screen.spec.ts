import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicationKit } from '../../models';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
import { IdeaRequests } from '../../services/idea-requests';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { PushNotifications } from '../../services/push-notifications';
import { TodayScreen } from './today-screen';

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

  it('shows the publication of the day and says the kit is still to come', async () => {
    const { item, element } = await openOnFirstPublication();

    expect(element.textContent).toContain(item.idea);
    expect(element.textContent).toContain('скоро появится');
    expect(element.querySelector('.caption__copy')).toBeNull();
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

    element.querySelector<HTMLButtonElement>('.caption__copy')?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('Показываю маникюр.\n\n#маникюр #иркутск');
    expect(element.querySelector('.entry__feedback')?.textContent).toContain('скопирован');
  });

  it('marks the publication as done', async () => {
    const { item, fixture, element } = await openOnFirstPublication();

    element.querySelector<HTMLInputElement>('.entry__check')?.click();
    await fixture.whenStable();

    expect(plan.items().find((candidate) => candidate.id === item.id)?.done).toBe(true);
    expect(element.querySelector('.entry--done')).not.toBeNull();
  });

  it('moves the publication to the next free day and lets the master undo it', async () => {
    const { item, fixture, element } = await openOnFirstPublication();

    element.querySelector<HTMLButtonElement>('.entry__move')?.click();
    await fixture.whenStable();

    const moved = plan.items().find((candidate) => candidate.id === item.id)!;
    expect(moved.date).not.toBe(item.date);
    expect(moved.movedFrom).toBe(item.date);
    expect(element.querySelector('.moved')?.textContent).toContain(`«${item.idea}» перенесено на`);

    element.querySelector<HTMLButtonElement>('.moved__undo')?.click();
    await fixture.whenStable();

    expect(element.querySelector('.moved')).toBeNull();
    expect(element.querySelector('.entry__return')).toBeNull();

    expect(plan.items().find((candidate) => candidate.id === item.id)?.date).toBe(item.date);
  });

  it('offers to return a moved publication to its original day at any time', async () => {
    const { item, fixture, element } = await openOnFirstPublication();
    const next = [...plan.items()].sort((a, b) => a.date.localeCompare(b.date))[1];
    plan.moveTo(next.id, item.date);
    await fixture.whenStable();

    const back = element.querySelector<HTMLButtonElement>('.entry__return');
    expect(back?.textContent).toContain('Вернуть на');
    back?.click();
    await fixture.whenStable();

    expect(plan.items().find((candidate) => candidate.id === next.id)?.date).toBe(next.date);
  });

  it('links to the idea replacement and shows when it is already requested', async () => {
    const { item, fixture, element } = await openOnFirstPublication();

    expect(element.querySelector('.entry__replace')?.getAttribute('href')).toBe(
      `/replace/${item.id}`,
    );

    localStorage.setItem(
      'helper.idea-requests',
      JSON.stringify({ [item.id]: { idea: item.idea, sentAt: 'x' } }),
    );
    TestBed.inject(IdeaRequests).marks.set({ [item.id]: { idea: item.idea, sentAt: 'x' } });
    await fixture.whenStable();

    expect(element.querySelector('.entry__replace')).toBeNull();
    expect(element.textContent).toContain('Замена запрошена');
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

  it('links to the finished content and tells while it is being processed', async () => {
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
    expect(element.textContent).not.toContain('Готовый контент');
    expect(element.textContent).not.toContain('Контент обрабатывается');

    TestBed.inject(Media).statuses.set([
      { ...base, id: 'm1', status: 'done' },
      { ...base, id: 'm2', status: 'running' },
    ]);
    fixture.detectChanges();

    const link = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).find((candidate) =>
      candidate.textContent?.includes('Готовый контент (1)'),
    );
    expect(link?.getAttribute('href')).toBe(`/content/${item.id}`);
    expect(element.textContent).toContain('Контент обрабатывается');
  });
  it('does not show the shooting card on an ordinary day', async () => {
    const { element } = await openOnFirstPublication();

    expect(element.querySelector('.shoot')).toBeNull();
  });
});
