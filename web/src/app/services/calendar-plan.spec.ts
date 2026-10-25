import { TestBed } from '@angular/core/testing';
import { CALENDAR_STORAGE_KEY } from '../constants';
import { samplePlan } from '../testing/plan-fixture';
import { CalendarPlan } from './calendar-plan';

const TODAY = new Date(2026, 9, 19, 10, 0);

describe('CalendarPlan', () => {
  let plan: CalendarPlan;

  beforeEach(() => {
    localStorage.clear();
    plan = TestBed.inject(CalendarPlan);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(plan.hasPlan()).toBe(false);
    expect(plan.weeks()).toEqual([]);
  });

  it('groups a four week plan by weeks from the start day', () => {
    plan.load(samplePlan(TODAY));

    expect(plan.items().length).toBe(12);
    expect(plan.startedOn()).toBe('2026-10-20');
    expect(plan.weeks().length).toBe(4);
    expect(plan.weeks()[0].from).toBe('2026-10-20');
    expect(plan.weeks()[3].to).toBe('2026-11-16');
    expect(plan.weeks().flatMap((week) => week.items).length).toBe(12);
  });

  it('shows the content day once per week on the right weekday', () => {
    const calendar = samplePlan(TODAY);
    plan.load({
      ...calendar,
      schedule: {
        ...calendar.schedule,
        slots: [
          { weekday: 3, time: '18:00' },
          { weekday: 6, time: '11:30' },
        ],
      },
    });

    const days = plan.weeks()[0].contentDays;
    expect(days).toEqual([
      { date: '2026-10-22', time: '18:00' },
      { date: '2026-10-25', time: '11:30' },
    ]);
    expect(plan.weeks()[1].contentDays[0].date).toBe('2026-10-29');
  });

  it('remembers the schedule and the plan', () => {
    plan.load(samplePlan(TODAY));
    plan.toggleDone(plan.items()[0].id);

    TestBed.resetTestingModule();
    const restored = TestBed.inject(CalendarPlan);

    expect(restored.items().length).toBe(12);
    expect(restored.items()[0].done).toBe(true);
    expect(restored.schedule()).toEqual({
      slots: [{ weekday: 3, time: '18:00' }],
      publishTime: '19:00',
    });
  });

  it('toggles a publication done and back', () => {
    plan.load(samplePlan(TODAY));
    const id = plan.items()[3].id;

    plan.toggleDone(id);
    expect(plan.items()[3].done).toBe(true);
    plan.toggleDone(id);
    expect(plan.items()[3].done).toBe(false);
  });

  it('forgets everything on reset', () => {
    plan.load(samplePlan(TODAY));

    plan.reset();

    expect(plan.hasPlan()).toBe(false);
    expect(localStorage.getItem(CALENDAR_STORAGE_KEY)).toBeNull();
  });

  it('ignores a corrupted or malformed store', () => {
    plan.load(samplePlan(TODAY));
    const stored = JSON.parse(localStorage.getItem(CALENDAR_STORAGE_KEY) ?? '{}') as {
      items: { time: string }[];
    };
    stored.items[0].time = '25:99';
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(stored));

    TestBed.resetTestingModule();
    expect(TestBed.inject(CalendarPlan).hasPlan()).toBe(false);

    localStorage.setItem(CALENDAR_STORAGE_KEY, '{not json');
    TestBed.resetTestingModule();
    expect(TestBed.inject(CalendarPlan).hasPlan()).toBe(false);
  });
});
