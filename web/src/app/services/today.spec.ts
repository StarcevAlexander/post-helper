import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ScheduleDraft, Strategy } from '../models';
import { CalendarPlan } from './calendar-plan';
import { Today } from './today';

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

describe('Today', () => {
  let plan: CalendarPlan;
  let today: Today;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    plan = TestBed.inject(CalendarPlan);
    today = TestBed.inject(Today);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  function startOn(date: Date): void {
    vi.setSystemTime(date);
    plan.build(draft, strategy, date);
  }

  it('picks publications of the current day', () => {
    startOn(new Date(2026, 9, 19, 10, 0));
    vi.setSystemTime(new Date(2026, 9, 21, 9, 0));

    today.refresh();

    expect(today.todayItems().length).toBeGreaterThan(0);
    expect(today.todayItems().every((item) => item.date === '2026-10-21')).toBe(true);
  });

  it('lists unfinished publications of earlier days as overdue', () => {
    startOn(new Date(2026, 9, 19, 10, 0));
    vi.setSystemTime(new Date(2026, 9, 22, 9, 0));
    const early = plan.items().find((item) => item.date < '2026-10-22');
    if (!early) {
      throw new Error('plan has no early items');
    }
    plan.toggleDone(early.id);

    today.refresh();

    expect(today.overdueItems().every((item) => !item.done && item.date < '2026-10-22')).toBe(true);
    expect(today.overdueItems().some((item) => item.id === early.id)).toBe(false);
  });

  it('suggests the nearest publication when nothing is due today', () => {
    startOn(new Date(2026, 9, 19, 10, 0));
    const first = plan
      .items()
      .map((item) => item.date)
      .sort()[0];
    vi.setSystemTime(new Date(2026, 9, 19, 9, 0));

    today.refresh();

    expect(first > '2026-10-19').toBe(true);
    expect(today.todayItems()).toEqual([]);
    expect(today.nextItem()?.date).toBe(first);
  });

  it('goes to the today screen from the today link and drops the parameter from the address', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    window.history.replaceState(null, '', '/?screen=today&a=1');

    today.openFromLink();

    expect(navigate).toHaveBeenCalledWith('/today');
    expect(window.location.search).toBe('?a=1');
  });

  it('ignores an address without the link', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    today.openFromLink();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('knows which week to shoot for on a content day and stays quiet on other days', () => {
    startOn(new Date(2026, 9, 19, 10, 0));
    const contentDay = plan.weeks()[1].contentDays[0].date;
    const [year, month, day] = contentDay.split('-').map(Number);

    vi.setSystemTime(new Date(year, month - 1, day, 9, 0));
    today.refresh();
    expect(today.shootWeek()).toBe(1);

    vi.setSystemTime(new Date(year, month - 1, day + 1, 9, 0));
    today.refresh();
    expect(today.shootWeek()).toBeUndefined();
  });

  it('has nothing to shoot without a plan', () => {
    today.refresh();

    expect(today.shootWeek()).toBeUndefined();
  });
});
