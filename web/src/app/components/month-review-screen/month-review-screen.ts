import { Component, inject } from '@angular/core';
import { LONG_DAY_FORMAT, MONTH_REVIEW_TEXTS } from '../../constants';
import { Intake } from '../../services/intake';
import { MonthReviews } from '../../services/month-reviews';
import { fromDateKey } from '../../utils/date-utils';

@Component({
  selector: 'app-month-review-screen',
  styleUrl: './month-review-screen.scss',
  templateUrl: './month-review-screen.html',
})
export class MonthReviewScreen {
  protected readonly reviews = inject(MonthReviews);
  private readonly intake = inject(Intake);
  protected readonly waiting = this.intake.reviewWaiting;
  protected readonly texts = MONTH_REVIEW_TEXTS;

  protected onAsk(): void {
    this.intake.askForReview();
  }

  protected period(from: string, to: string): string {
    return `${LONG_DAY_FORMAT.format(fromDateKey(from))} – ${LONG_DAY_FORMAT.format(fromDateKey(to))}`;
  }
}
