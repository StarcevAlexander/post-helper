import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { APP_LINK_PARAM } from '../constants';
import { PlanItem } from '../models';
import { isTodayLink } from '../utils/app-link';
import { addDays, toDateKey } from '../utils/date-utils';
import { CalendarPlan } from './calendar-plan';

function byMoment(first: PlanItem, second: PlanItem): number {
  return `${first.date} ${first.time}`.localeCompare(`${second.date} ${second.time}`);
}

@Service()
export class Today {
  private readonly plan = inject(CalendarPlan);
  private readonly router = inject(Router);
  private readonly now = signal(new Date());
  private rolloverTimer: ReturnType<typeof setTimeout> | undefined;

  readonly todayKey = computed(() => toDateKey(this.now()));
  readonly todayItems = computed(() =>
    this.plan
      .items()
      .filter((item) => item.date === this.todayKey())
      .sort(byMoment),
  );
  readonly overdueItems = computed(() =>
    this.plan
      .items()
      .filter((item) => !item.done && item.date < this.todayKey())
      .sort(byMoment),
  );
  readonly shootWeek = computed(
    () =>
      this.plan.weeks().find((week) => week.contentDays.some((day) => day.date === this.todayKey()))
        ?.index,
  );
  readonly nextItem = computed<PlanItem | undefined>(() =>
    this.todayItems().length > 0
      ? undefined
      : this.plan
          .items()
          .filter((item) => !item.done && item.date > this.todayKey())
          .sort(byMoment)[0],
  );

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refresh();
        }
      });
    }
    this.refresh();
  }

  refresh(): void {
    const now = new Date();
    this.now.set(now);
    clearTimeout(this.rolloverTimer);
    const midnight = addDays(now, 1).getTime();
    this.rolloverTimer = setTimeout(() => this.refresh(), Math.max(1000, midnight - now.getTime()));
  }

  openFromLink(): void {
    if (!isTodayLink(window.location.search)) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(APP_LINK_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    void this.router.navigateByUrl('/today');
  }
}
