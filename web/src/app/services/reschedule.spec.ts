import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RESCHEDULE_FEEDBACK_MS } from '../constants';
import { samplePlan } from '../testing/plan-fixture';
import { toDateKey } from '../utils/date-utils';
import { CalendarPlan } from './calendar-plan';
import { Reschedule } from './reschedule';
import { Today } from './today';

const TODAY = new Date(2026, 9, 19, 10, 0);

describe('Reschedule', () => {
  let plan: CalendarPlan;
  let reschedule: Reschedule;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    plan = TestBed.inject(CalendarPlan);
    plan.load(samplePlan(TODAY));
    reschedule = TestBed.inject(Reschedule);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  function item(index: number) {
    return [...plan.items()].sort((a, b) => a.date.localeCompare(b.date))[index];
  }

  it('moves a publication to the next free day and remembers where it came from', () => {
    const first = item(0);

    reschedule.move(first.id);

    const moved = plan.items().find((candidate) => candidate.id === first.id)!;
    expect(moved.date).toBe('2026-10-24');
    expect(moved.movedFrom).toBe(first.date);
    expect(reschedule.describe(reschedule.last()!)).toBe(
      `«${first.idea}» перенесено на сб, 24 окт.`,
    );
  });

  it('starts from today for an overdue publication', () => {
    const first = item(0);
    vi.setSystemTime(new Date(2026, 10, 20, 9, 0));
    TestBed.inject(Today).refresh();
    plan.moveTo(first.id, '2026-10-01');

    reschedule.move(first.id);

    const moved = plan.items().find((candidate) => candidate.id === first.id)!;
    expect(moved.date).toBe(toDateKey(new Date(2026, 10, 20)));
    expect(moved.movedFrom).toBe(first.date);
  });

  it('undoes the move and clears the message after a while', () => {
    const first = item(0);
    reschedule.move(first.id);

    reschedule.undo();

    const restored = plan.items().find((candidate) => candidate.id === first.id)!;
    expect(restored.date).toBe(first.date);
    expect(restored.movedFrom).toBeUndefined();
    expect(reschedule.last()).toBeUndefined();

    reschedule.move(first.id);
    vi.advanceTimersByTime(RESCHEDULE_FEEDBACK_MS + 1);
    expect(reschedule.last()).toBeUndefined();
    expect(plan.items().find((candidate) => candidate.id === first.id)?.date).toBe('2026-10-24');
  });

  it('says so when no free day is found', () => {
    const calendar = samplePlan(TODAY);
    const start = new Date(2026, 9, 20);
    const items = Array.from({ length: 70 }, (_, offset) => ({
      ...calendar.items[0],
      id: `day-${offset}`,
      date: toDateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)),
    }));
    plan.load({ ...calendar, items });

    reschedule.move('day-0');

    expect(reschedule.describe(reschedule.last()!)).toContain('не нашлось');
    expect(reschedule.last()?.to).toBeUndefined();
    expect(plan.items().find((candidate) => candidate.id === 'day-0')?.date).toBe('2026-10-20');
  });
});
