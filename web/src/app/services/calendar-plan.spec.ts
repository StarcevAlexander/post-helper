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

  it('moves a publication to the next free day after it and undoes the move', () => {
    plan.load(samplePlan(TODAY));
    const [first, second] = [...plan.items()].sort((a, b) => a.date.localeCompare(b.date));

    const result = plan.reschedule(first.id, '2026-10-19');
    const moved = plan.items().find((item) => item.id === first.id)!;

    expect(result).toEqual({ id: first.id, from: first.date, to: '2026-10-24' });
    expect(moved.date).toBe('2026-10-24');
    expect(moved.movedFrom).toBe(first.date);
    expect(plan.items().find((item) => item.id === second.id)?.date).toBe(second.date);

    plan.undoMove(first.id);
    const restored = plan.items().find((item) => item.id === first.id)!;
    expect(restored.date).toBe(first.date);
    expect(restored).not.toHaveProperty('movedFrom');
  });

  it('grows the week list when a publication is moved past the fourth week', () => {
    plan.load(samplePlan(TODAY));
    const last = [...plan.items()].sort((a, b) => b.date.localeCompare(a.date))[0];

    plan.moveTo(last.id, '2026-11-18');

    expect(plan.weeks().length).toBe(5);
    expect(plan.weeks()[4].items.map((item) => item.id)).toEqual([last.id]);
    expect(plan.weeks()[4].contentDays).toEqual([]);
  });

  it('keeps the first origin when a publication is moved twice', () => {
    plan.load(samplePlan(TODAY));
    const first = [...plan.items()].sort((a, b) => a.date.localeCompare(b.date))[0];

    plan.reschedule(first.id, '2026-10-19');
    plan.reschedule(first.id, '2026-10-19');
    const moved = plan.items().find((item) => item.id === first.id)!;

    expect(moved.date).toBe('2026-10-25');
    expect(moved.movedFrom).toBe(first.date);
    expect(plan.reschedule('missing', '2026-10-19')).toBeUndefined();
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
