import { Service, computed, signal } from '@angular/core';
import {
  CALENDAR_STORAGE_KEY,
  FORMAT_ORDER,
  PLAN_WEEKS,
  RESCHEDULE_SEARCH_DAYS,
  TIME_PATTERN,
} from '../constants';
import {
  ContentSlot,
  PlanItem,
  PlanWeek,
  PostFormat,
  RescheduleResult,
  Schedule,
  StoredCalendar,
} from '../models';
import {
  addDays,
  daysBetween,
  fromDateKey,
  mondayFirstWeekday,
  toDateKey,
} from '../utils/date-utils';

function isSlot(value: unknown): value is ContentSlot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['weekday'] === 'number' &&
    Number.isInteger(candidate['weekday']) &&
    candidate['weekday'] >= 0 &&
    candidate['weekday'] <= 6 &&
    typeof candidate['time'] === 'string' &&
    TIME_PATTERN.test(candidate['time'])
  );
}

function isItem(value: unknown): value is PlanItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['date'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate['date']) &&
    typeof candidate['time'] === 'string' &&
    TIME_PATTERN.test(candidate['time']) &&
    FORMAT_ORDER.includes(candidate['format'] as PostFormat) &&
    typeof candidate['pillar'] === 'string' &&
    typeof candidate['idea'] === 'string' &&
    typeof candidate['done'] === 'boolean' &&
    (candidate['movedFrom'] === undefined ||
      (typeof candidate['movedFrom'] === 'string' && DATE_PATTERN.test(candidate['movedFrom'])))
  );
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isStoredCalendar(value: unknown): value is StoredCalendar {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const schedule = candidate['schedule'] as Record<string, unknown> | null;
  return (
    typeof candidate['startedOn'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate['startedOn']) &&
    Array.isArray(candidate['items']) &&
    candidate['items'].every(isItem) &&
    typeof schedule === 'object' &&
    schedule !== null &&
    typeof schedule['publishTime'] === 'string' &&
    TIME_PATTERN.test(schedule['publishTime']) &&
    Array.isArray(schedule['slots']) &&
    schedule['slots'].every(isSlot)
  );
}

@Service()
export class CalendarPlan {
  private readonly stored = this.restore();

  readonly schedule = signal<Schedule | undefined>(this.stored?.schedule);
  readonly items = signal<PlanItem[]>(this.stored?.items ?? []);
  readonly startedOn = signal<string | undefined>(this.stored?.startedOn);

  readonly hasPlan = computed(() => this.items().length > 0);
  readonly weeks = computed<PlanWeek[]>(() => this.groupWeeks());

  load(calendar: StoredCalendar): void {
    this.schedule.set(calendar.schedule);
    this.items.set(calendar.items);
    this.startedOn.set(calendar.startedOn);
    this.save();
  }

  toggleDone(id: string): void {
    this.items.update((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    );
    this.save();
  }

  reschedule(id: string, todayKey: string): RescheduleResult | undefined {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item) {
      return undefined;
    }
    const taken = new Set(
      this.items()
        .filter((other) => other.id !== id)
        .map((other) => other.date),
    );
    const dayAfter = toDateKey(addDays(fromDateKey(item.date), 1));
    const start = fromDateKey(dayAfter > todayKey ? dayAfter : todayKey);
    for (let offset = 0; offset < RESCHEDULE_SEARCH_DAYS; offset += 1) {
      const candidate = toDateKey(addDays(start, offset));
      if (!taken.has(candidate)) {
        this.moveTo(id, candidate);
        return { id, from: item.date, to: candidate };
      }
    }
    return { id, from: item.date };
  }

  moveTo(id: string, date: string): void {
    this.items.update((items) =>
      items.map((item) => {
        if (item.id !== id || item.date === date) {
          return item;
        }
        const origin = item.movedFrom ?? item.date;
        const { movedFrom, ...rest } = item;
        return origin === date ? { ...rest, date } : { ...rest, date, movedFrom: origin };
      }),
    );
    this.save();
  }

  undoMove(id: string): void {
    const item = this.items().find((candidate) => candidate.id === id);
    if (item?.movedFrom) {
      this.moveTo(id, item.movedFrom);
    }
  }

  reset(): void {
    this.schedule.set(undefined);
    this.items.set([]);
    this.startedOn.set(undefined);
    try {
      localStorage.removeItem(CALENDAR_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private groupWeeks(): PlanWeek[] {
    const startedOn = this.startedOn();
    const schedule = this.schedule();
    if (!startedOn || !schedule) {
      return [];
    }
    const start = fromDateKey(startedOn);
    const lastOffset = Math.max(
      0,
      ...this.items().map((item) => daysBetween(start, fromDateKey(item.date))),
    );
    const span = Math.max(PLAN_WEEKS, Math.ceil((lastOffset + 1) / 7));
    return Array.from({ length: span }, (_, index): PlanWeek => {
      const from = addDays(start, index * 7);
      return {
        index,
        from: toDateKey(from),
        to: toDateKey(addDays(from, 6)),
        items: this.items().filter((item) => {
          const offset = daysBetween(start, fromDateKey(item.date));
          return offset >= index * 7 && offset < index * 7 + 7;
        }),
        contentDays:
          index < PLAN_WEEKS
            ? schedule.slots.map((slot) => ({
                date: toDateKey(addDays(from, (slot.weekday - mondayFirstWeekday(from) + 7) % 7)),
                time: slot.time,
              }))
            : [],
      };
    });
  }

  private save(): void {
    const schedule = this.schedule();
    const startedOn = this.startedOn();
    if (!schedule || !startedOn) {
      return;
    }
    const calendar: StoredCalendar = { schedule, items: this.items(), startedOn };
    try {
      localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendar));
    } catch {
      return;
    }
  }

  private restore(): StoredCalendar | undefined {
    try {
      const raw = localStorage.getItem(CALENDAR_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      return isStoredCalendar(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
