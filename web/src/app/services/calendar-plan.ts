import { Service, computed, signal } from '@angular/core';
import {
  CALENDAR_STORAGE_KEY,
  CONTENT_DAY_ALARM_MINUTES,
  CONTENT_DAY_DURATION_MINUTES,
  CONTENT_DAY_EVENT_TEXT,
  CONTENT_DAY_EVENT_TITLE,
  DEFAULT_DRAFT,
  FORMAT_LABELS,
  ITEM_ALARM_MINUTES,
  ITEM_DURATION_MINUTES,
  ITEM_EVENT_TEXT,
  PLAN_WEEKS,
  TIME_PATTERN,
  WEEKDAY_NAMES,
} from '../constants';
import {
  ContentSlot,
  IcsEvent,
  PlanItem,
  PlanWeek,
  PostFormat,
  Schedule,
  ScheduleDraft,
  StoredCalendar,
  Strategy,
} from '../models';
import {
  addDays,
  daysBetween,
  fromDateKey,
  mondayFirstWeekday,
  nextWeekday,
  toDateKey,
  withTime,
} from '../utils/date-utils';
import { buildPlan } from '../utils/plan-builder';

const FORMATS: readonly PostFormat[] = ['reels', 'post', 'stories'];

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
    FORMATS.includes(candidate['format'] as PostFormat) &&
    typeof candidate['pillar'] === 'string' &&
    typeof candidate['idea'] === 'string' &&
    typeof candidate['done'] === 'boolean'
  );
}

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

  toDraft(): ScheduleDraft {
    const schedule = this.schedule();
    if (!schedule) {
      return { ...DEFAULT_DRAFT };
    }
    const [first, second] = schedule.slots;
    return {
      weekday1: first ? String(first.weekday) : '',
      time1: first?.time ?? DEFAULT_DRAFT.time1,
      weekday2: second ? String(second.weekday) : '',
      time2: second?.time ?? DEFAULT_DRAFT.time2,
      publishTime: schedule.publishTime,
    };
  }

  build(draft: ScheduleDraft, strategy: Strategy, today = new Date()): void {
    const slots: ContentSlot[] = [{ weekday: Number(draft.weekday1), time: draft.time1 }];
    if (draft.weekday2 !== '') {
      slots.push({ weekday: Number(draft.weekday2), time: draft.time2 });
    }
    const schedule: Schedule = { slots, publishTime: draft.publishTime };
    const start = addDays(today, 1);
    this.schedule.set(schedule);
    this.items.set(buildPlan(strategy, start, schedule.publishTime));
    this.startedOn.set(toDateKey(start));
    this.save();
  }

  toggleDone(id: string): void {
    this.items.update((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    );
    this.save();
  }

  icsEvents(now = new Date(), link?: string): IcsEvent[] {
    const schedule = this.schedule();
    if (!schedule) {
      return [];
    }
    const withLink = (text: string): string => (link ? `${text}\n${link}` : text);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const contentDays = schedule.slots.map((slot): IcsEvent => ({
      uid: `content-day-${slot.weekday}@pomoshchnik`,
      summary: `${CONTENT_DAY_EVENT_TITLE}, ${WEEKDAY_NAMES[slot.weekday].toLowerCase()}`,
      description: withLink(CONTENT_DAY_EVENT_TEXT),
      start: withTime(nextWeekday(today, slot.weekday), slot.time),
      durationMinutes: CONTENT_DAY_DURATION_MINUTES,
      alarmMinutes: CONTENT_DAY_ALARM_MINUTES,
      weeklyOn: slot.weekday,
      url: link,
    }));
    const publications = this.items()
      .filter((item) => !item.done)
      .map((item): IcsEvent => ({
        uid: `item-${item.id}@pomoshchnik`,
        summary: `${FORMAT_LABELS[item.format]}: ${item.idea}`,
        description: withLink(`Рубрика: ${item.pillar}\n${ITEM_EVENT_TEXT}`),
        start: withTime(fromDateKey(item.date), item.time),
        durationMinutes: ITEM_DURATION_MINUTES,
        alarmMinutes: ITEM_ALARM_MINUTES,
        url: link,
      }))
      .filter((event) => event.start.getTime() > now.getTime());
    return [...contentDays, ...publications];
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
    return Array.from({ length: PLAN_WEEKS }, (_, index): PlanWeek => {
      const from = addDays(start, index * 7);
      return {
        index,
        from: toDateKey(from),
        to: toDateKey(addDays(from, 6)),
        items: this.items().filter((item) => {
          const offset = daysBetween(start, fromDateKey(item.date));
          return offset >= index * 7 && offset < index * 7 + 7;
        }),
        contentDays: schedule.slots.map((slot) => ({
          date: toDateKey(addDays(from, (slot.weekday - mondayFirstWeekday(from) + 7) % 7)),
          time: slot.time,
        })),
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
