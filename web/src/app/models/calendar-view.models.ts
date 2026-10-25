import { PlanItem } from './schedule.models';

export interface CalendarItemView {
  item: PlanItem;
  dayLabel: string;
  formatLabel: string;
  hasKit: boolean;
  refLabel?: string;
  refStale: boolean;
}

export interface CalendarWeekView {
  index: number;
  title: string;
  contentDays: string[];
  items: CalendarItemView[];
}
