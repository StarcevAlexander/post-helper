import { KitStatus } from './kit.models';
import { PlanItem } from './schedule.models';

export interface TodayEntry {
  item: PlanItem;
  whenLabel: string;
  formatLabel: string;
  status: KitStatus;
  error?: string;
  refLabel?: string;
  refStale: boolean;
}

export interface TodayCopyFeedback {
  id: string;
  ok: boolean;
}

export type TodaySectionKind = 'today' | 'next' | 'overdue';

export interface TodaySection {
  kind: TodaySectionKind;
  title: string;
  entries: TodayEntry[];
}
