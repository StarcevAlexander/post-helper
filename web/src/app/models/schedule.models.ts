export type PostFormat = 'reels' | 'post' | 'stories';

export interface ContentSlot {
  weekday: number;
  time: string;
}

export interface Schedule {
  slots: ContentSlot[];
  publishTime: string;
}

export interface ScheduleDraft {
  weekday1: string;
  time1: string;
  weekday2: string;
  time2: string;
  publishTime: string;
}

export interface PlanItem {
  id: string;
  date: string;
  time: string;
  format: PostFormat;
  pillar: string;
  idea: string;
  done: boolean;
}

export interface PlanWeek {
  index: number;
  from: string;
  to: string;
  items: PlanItem[];
  contentDays: ContentDayOccurrence[];
}

export interface ContentDayOccurrence {
  date: string;
  time: string;
}

export interface StoredCalendar {
  schedule: Schedule;
  items: PlanItem[];
  startedOn: string;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  start: Date;
  durationMinutes: number;
  alarmMinutes: number;
  weeklyOn?: number;
}
