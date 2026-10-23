import { Service, computed, inject, signal } from '@angular/core';
import { APP_LINK_PARAM } from '../constants';
import { PlanItem } from '../models';
import { isTodayLink } from '../utils/app-link';
import { toDateKey } from '../utils/date-utils';
import { CalendarPlan } from './calendar-plan';

function byMoment(first: PlanItem, second: PlanItem): number {
  return `${first.date} ${first.time}`.localeCompare(`${second.date} ${second.time}`);
}

@Service()
export class Today {
  private readonly plan = inject(CalendarPlan);
  private readonly now = signal(new Date());

  readonly open = signal(false);

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
  readonly nextItem = computed<PlanItem | undefined>(() =>
    this.todayItems().length > 0
      ? undefined
      : this.plan
          .items()
          .filter((item) => !item.done && item.date > this.todayKey())
          .sort(byMoment)[0],
  );

  show(): void {
    this.now.set(new Date());
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
    if (!isTodayLink(window.location.search)) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(APP_LINK_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }

  openFromLink(): void {
    if (isTodayLink(window.location.search)) {
      this.show();
    }
  }
}
