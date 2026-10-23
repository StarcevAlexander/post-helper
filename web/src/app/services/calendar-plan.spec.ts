import { TestBed } from '@angular/core/testing';
import { CALENDAR_STORAGE_KEY } from '../constants';
import { ScheduleDraft, Strategy } from '../models';
import { toDateKey } from '../utils/date-utils';
import { CalendarPlan } from './calendar-plan';

const TODAY = new Date(2026, 9, 19, 10, 0);

const strategy: Strategy = {
  summary: 'Ок',
  positioning: '',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
    { title: 'Окошки', description: '', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 2, posts: 2, stories: 5, note: '' },
  firstSteps: [],
};

const draft: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: '19:00',
};

describe('CalendarPlan', () => {
  let plan: CalendarPlan;

  beforeEach(() => {
    localStorage.clear();
    plan = TestBed.inject(CalendarPlan);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts empty with a default draft', () => {
    expect(plan.hasPlan()).toBe(false);
    expect(plan.weeks()).toEqual([]);
    expect(plan.toDraft().weekday2).toBe('');
  });

  it('builds a four week plan that starts tomorrow', () => {
    plan.build(draft, strategy, TODAY);

    expect(plan.items().length).toBe(36);
    expect(plan.startedOn()).toBe('2026-10-20');
    expect(plan.weeks().length).toBe(4);
    expect(plan.weeks()[0].from).toBe('2026-10-20');
    expect(plan.weeks()[3].to).toBe('2026-11-16');
    expect(plan.weeks().flatMap((week) => week.items).length).toBe(36);
  });

  it('shows the content day once per week on the right weekday', () => {
    plan.build({ ...draft, weekday2: '6', time2: '11:30' }, strategy, TODAY);

    const days = plan.weeks()[0].contentDays;
    expect(days).toEqual([
      { date: '2026-10-22', time: '18:00' },
      { date: '2026-10-25', time: '11:30' },
    ]);
    expect(plan.weeks()[1].contentDays[0].date).toBe('2026-10-29');
  });

  it('remembers the schedule and the plan', () => {
    plan.build(draft, strategy, TODAY);
    plan.toggleDone(plan.items()[0].id);

    TestBed.resetTestingModule();
    const restored = TestBed.inject(CalendarPlan);

    expect(restored.items().length).toBe(36);
    expect(restored.items()[0].done).toBe(true);
    expect(restored.toDraft()).toEqual(draft);
  });

  it('toggles a publication done and back', () => {
    plan.build(draft, strategy, TODAY);
    const id = plan.items()[3].id;

    plan.toggleDone(id);
    expect(plan.items()[3].done).toBe(true);
    plan.toggleDone(id);
    expect(plan.items()[3].done).toBe(false);
  });

  it('exports a weekly content day and the upcoming publications', () => {
    plan.build({ ...draft, weekday2: '6' }, strategy, TODAY);

    const events = plan.icsEvents(TODAY);

    const weekly = events.filter((event) => event.weeklyOn !== undefined);
    expect(weekly.map((event) => toDateKey(event.start))).toEqual(['2026-10-22', '2026-10-25']);
    expect(weekly[0].summary).toContain('четверг');
    expect(events.length).toBe(2 + 36);
  });

  it('puts the app link into every exported event when asked', () => {
    plan.build(draft, strategy, TODAY);
    const link = 'https://example.github.io/post_helper/?screen=today';

    const events = plan.icsEvents(TODAY, link);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.url === link)).toBe(true);
    expect(events.every((event) => event.description.endsWith(`\n${link}`))).toBe(true);
    expect(plan.icsEvents(TODAY).every((event) => event.url === undefined)).toBe(true);
  });

  it('leaves done and past publications out of the export', () => {
    plan.build(draft, strategy, TODAY);
    plan.toggleDone(plan.items()[0].id);
    const later = new Date(2026, 10, 1, 12, 0);

    const events = plan.icsEvents(later).filter((event) => event.weeklyOn === undefined);

    expect(events.every((event) => event.start.getTime() > later.getTime())).toBe(true);
    expect(events.length).toBeLessThan(35);
  });

  it('exports nothing without a schedule', () => {
    expect(plan.icsEvents(TODAY)).toEqual([]);
  });

  it('forgets everything on reset', () => {
    plan.build(draft, strategy, TODAY);

    plan.reset();

    expect(plan.hasPlan()).toBe(false);
    expect(localStorage.getItem(CALENDAR_STORAGE_KEY)).toBeNull();
  });

  it('ignores a corrupted or malformed store', () => {
    plan.build(draft, strategy, TODAY);
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
