import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LONG_DAY_FORMAT, MONTH_REVIEW_TEXTS } from '../../constants';
import { CalendarPlan } from '../../services/calendar-plan';
import { Intake } from '../../services/intake';
import { MonthReviews } from '../../services/month-reviews';
import { daysBetween, fromDateKey } from '../../utils/date-utils';

function pluralDays(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return 'дней';
  }
  if (mod10 === 1) {
    return 'день';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'дня';
  }
  return 'дней';
}

@Component({
  imports: [RouterLink],
  selector: 'app-month-review-screen',
  styleUrl: './month-review-screen.scss',
  templateUrl: './month-review-screen.html',
})
export class MonthReviewScreen {
  protected readonly reviews = inject(MonthReviews);
  private readonly intake = inject(Intake);
  private readonly plan = inject(CalendarPlan);
  protected readonly waiting = this.intake.reviewWaiting;
  protected readonly texts = MONTH_REVIEW_TEXTS;
  protected readonly daysLeftText = computed(() => {
    const dates = this.plan.items().map((item) => item.date).sort();
    const last = dates[dates.length - 1];
    if (last === undefined) {
      return undefined;
    }
    const days = daysBetween(new Date(), fromDateKey(last));
    if (days < 0) {
      return undefined;
    }
    return days === 0
      ? this.texts.daysLeftToday
      : `${this.texts.daysLeft}: ${days} ${pluralDays(days)}`;
  });

  protected onAsk(): void {
    this.intake.askForReview();
  }

  protected period(from: string, to: string): string {
    return `${LONG_DAY_FORMAT.format(fromDateKey(from))} – ${LONG_DAY_FORMAT.format(fromDateKey(to))}`;
  }
}
