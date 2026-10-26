import { PlanItem } from './schedule.models';

export interface ShootLine {
  label?: string;
  text: string;
}

export interface ShootUnit {
  mark: string;
  index: number;
  title: string;
  overlay?: string;
  lines: ShootLine[];
}

export interface ShootEntry {
  item: PlanItem;
  title: string;
  contentLabel?: string;
  when: string;
  units: ShootUnit[];
  readyMark: string;
  marks: string[];
}

export interface ShootWeekView {
  heading: string;
  contentDays: string[];
  entries: ShootEntry[];
}
