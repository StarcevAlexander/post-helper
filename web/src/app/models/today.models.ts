import { PlanItem } from './schedule.models';

export interface TodayEntry {
  item: PlanItem;
  whenLabel: string;
  formatLabel: string;
  contentPending: boolean;
}

export interface TodayCopyFeedback {
  id: string;
  ok: boolean;
}

export interface ItemCopyFeedback {
  ok: boolean;
}

export type TodaySectionKind = 'today' | 'next' | 'overdue';

export interface TodaySection {
  kind: TodaySectionKind;
  title: string;
  entries: TodayEntry[];
}
