import { Service, computed, inject, signal } from '@angular/core';
import { MONTH_REVIEWS_STORAGE_KEY, MONTH_REVIEW_DUE_DAYS } from '../constants';
import { MonthReview } from '../models';
import { daysBetween, fromDateKey } from '../utils/date-utils';
import { CalendarPlan } from './calendar-plan';

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isReview(value: unknown): value is MonthReview {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['from'] === 'string' &&
    typeof candidate['to'] === 'string' &&
    typeof candidate['planned'] === 'number' &&
    typeof candidate['done'] === 'number' &&
    typeof candidate['headline'] === 'string' &&
    typeof candidate['note'] === 'string' &&
    isStringList(candidate['facts']) &&
    isStringList(candidate['conclusions']) &&
    isStringList(candidate['changes'])
  );
}

@Service()
export class MonthReviews {
  private readonly plan = inject(CalendarPlan);

  readonly items = signal<MonthReview[]>(this.restore());

  readonly latestFirst = computed(() => [...this.items()].reverse());
  readonly daysLeft = computed(() => {
    const dates = this.plan.items().map((item) => item.date);
    if (dates.length === 0) {
      return undefined;
    }
    const last = dates.reduce((a, b) => (a > b ? a : b));
    return daysBetween(new Date(), fromDateKey(last));
  });
  readonly due = computed(() => {
    const left = this.daysLeft();
    return left !== undefined && left <= MONTH_REVIEW_DUE_DAYS;
  });
  readonly available = computed(() => this.plan.hasPlan() || this.items().length > 0);

  private restore(): MonthReview[] {
    try {
      const raw = localStorage.getItem(MONTH_REVIEWS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      return Array.isArray(parsed) ? parsed.filter(isReview) : [];
    } catch {
      return [];
    }
  }
}
