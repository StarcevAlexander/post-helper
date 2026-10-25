import { Service, inject, signal } from '@angular/core';
import { DAY_FORMAT, RESCHEDULE_FEEDBACK_MS, RESCHEDULE_TEXTS } from '../constants';
import { RescheduleResult } from '../models';
import { fromDateKey } from '../utils/date-utils';
import { CalendarPlan } from './calendar-plan';
import { Today } from './today';

@Service()
export class Reschedule {
  private readonly plan = inject(CalendarPlan);
  private readonly today = inject(Today);

  readonly last = signal<RescheduleResult | undefined>(undefined);

  private timer: ReturnType<typeof setTimeout> | undefined;

  move(id: string): void {
    const result = this.plan.reschedule(id, this.today.todayKey());
    this.last.set(result);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.last.set(undefined), RESCHEDULE_FEEDBACK_MS);
  }

  undo(): void {
    const last = this.last();
    if (last?.to) {
      this.plan.undoMove(last.id);
    }
    this.dismiss();
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.last.set(undefined);
  }

  describe(result: RescheduleResult): string {
    if (!result.to) {
      return RESCHEDULE_TEXTS.noFreeDay;
    }
    const idea = this.plan.items().find((item) => item.id === result.id)?.idea;
    const target = DAY_FORMAT.format(fromDateKey(result.to));
    return idea
      ? `«${idea}» ${RESCHEDULE_TEXTS.movedLower} ${target}`
      : `${RESCHEDULE_TEXTS.moved} ${target}`;
  }
}
