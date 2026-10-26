import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CALENDAR_HINT,
  CONTENT_DAY_WEEK_LABEL,
  DAY_FORMAT,
  DONE_LABEL,
  FORMAT_LABELS,
  IDEA_REQUEST_TEXTS,
  RANGE_FORMAT,
  KIT_OPEN_LABEL,
  KIT_PENDING_LABEL,
  REFS_TEXTS,
  RESCHEDULE_TEXTS,
  SHOOT_TEXTS,
  PLAN_EMPTY_TEXT,
  PLAN_TITLE,
  WEEK_LABEL,
} from '../../constants';
import { CalendarWeekView } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { IdeaRequests } from '../../services/idea-requests';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { Refs } from '../../services/refs';
import { Reschedule } from '../../services/reschedule';
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
  private readonly media = inject(Media);
  protected readonly reschedule = inject(Reschedule);
  protected readonly ideas = inject(IdeaRequests);
  protected readonly refsTexts = REFS_TEXTS;
  protected readonly moveTexts = RESCHEDULE_TEXTS;
  protected readonly ideaTexts = IDEA_REQUEST_TEXTS;
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
        contentLabel: this.media.contentLabel(item.id),
        ideaRequested: this.ideas.requested(item),
      })),
    })),
  );

  protected movedLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.movedFrom} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  protected returnLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.undoTo} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

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
