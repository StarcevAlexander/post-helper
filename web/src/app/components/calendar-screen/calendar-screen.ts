import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CALENDAR_HINT,
  CONTENT_DAY_WEEK_LABEL,
  DAY_FORMAT,
  DONE_LABEL,
  FORMAT_LABELS,
  RANGE_FORMAT,
  KIT_OPEN_LABEL,
  KIT_PENDING_LABEL,
  REFS_TEXTS,
  SHOOT_TEXTS,
  PLAN_EMPTY_TEXT,
  PLAN_TITLE,
  WEEK_LABEL,
} from '../../constants';
import { CalendarWeekView } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Refs } from '../../services/refs';
import { fromDateKey } from '../../utils/date-utils';

@Component({
  imports: [RouterLink],
  selector: 'app-calendar-screen',
  styleUrl: './calendar-screen.scss',
  templateUrl: './calendar-screen.html',
})
export class CalendarScreen {
  protected readonly plan = inject(CalendarPlan);
  protected readonly kits = inject(Kits);
  protected readonly refs = inject(Refs);
  protected readonly refsTexts = REFS_TEXTS;
  protected readonly openKitLabel = KIT_OPEN_LABEL;
  protected readonly shootLabel = SHOOT_TEXTS.weekLink;
  protected readonly kitPendingLabel = KIT_PENDING_LABEL;
  protected readonly hint = CALENDAR_HINT;
  protected readonly planTitle = PLAN_TITLE;
  protected readonly emptyText = PLAN_EMPTY_TEXT;
  protected readonly doneLabel = DONE_LABEL;
  protected readonly weekViews = computed<CalendarWeekView[]>(() =>
    this.plan.weeks().map((week) => ({
      index: week.index,
      title: `${WEEK_LABEL} ${week.index + 1}, ${RANGE_FORMAT.format(fromDateKey(week.from))} – ${RANGE_FORMAT.format(fromDateKey(week.to))}`,
      contentDays: week.contentDays.map(
        (day) =>
          `${CONTENT_DAY_WEEK_LABEL}: ${DAY_FORMAT.format(fromDateKey(day.date))}, ${day.time}`,
      ),
      items: week.items.map((item) => ({
        item,
        dayLabel: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time}`,
        formatLabel: FORMAT_LABELS[item.format],
        hasKit: this.kits.kitFor(item) !== undefined,
        refLabel: this.refLabel(item.id),
        refStale: this.refs.byKey().get(item.id)?.stale ?? false,
      })),
    })),
  );

  private refLabel(key: string): string | undefined {
    const status = this.refs.byKey().get(key);
    switch (status?.status) {
      case undefined:
        return undefined;
      case 'done':
        return status.stale ? REFS_TEXTS.stale : `${REFS_TEXTS.open} (${status.files.length})`;
      case 'failed':
        return REFS_TEXTS.failed;
      case 'made':
        return REFS_TEXTS.made;
      default:
        return REFS_TEXTS.making;
    }
  }
}
