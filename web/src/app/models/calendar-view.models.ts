import { PlanItem } from './schedule.models';

export interface CalendarItemView {
  item: PlanItem;
  dayLabel: string;
  formatLabel: string;
}

export interface CalendarWeekView {
  index: number;
  title: string;
  contentDays: string[];
  items: CalendarItemView[];
}
