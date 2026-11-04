import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CALENDAR_HINT,
  CONTENT_DAY_WEEK_LABEL,
  DAY_FORMAT,
  DONE_LABEL,
  FORMAT_LABELS,
  MEDIA_TEXTS,
  RANGE_FORMAT,
  REFS_TEXTS,
  RESCHEDULE_TEXTS,
  SHOOT_TEXTS,
  PLAN_EMPTY_TEXT,
  PLAN_TITLE,
  WEEK_LABEL,
} from '../../constants';
import { CalendarWeekView } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
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
  protected readonly refs = inject(Refs);
  protected readonly reschedule = inject(Reschedule);
  private readonly media = inject(Media);
  protected readonly refsTexts = REFS_TEXTS;
  protected readonly mediaTexts = MEDIA_TEXTS;
  protected readonly moveTexts = RESCHEDULE_TEXTS;
  protected readonly shootLabel = SHOOT_TEXTS.weekLink;
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
        contentPending: this.media.contentPending(item.id),
      })),
    })),
  );

  protected movedLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.movedFrom} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  private touchStart: { id: string; x: number; y: number } | undefined;

  protected onTouchStart(event: TouchEvent, id: string): void {
    const touch = event.touches[0];
    this.touchStart = { id, x: touch.clientX, y: touch.clientY };
  }

  protected onTouchEnd(event: TouchEvent, id: string): void {
    const start = this.touchStart;
    this.touchStart = undefined;
    if (!start || start.id !== id) {
      return;
    }
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) {
      return;
    }
    const item = this.plan.items().find((candidate) => candidate.id === id);
    if (!item || item.done) {
      return;
    }
    event.preventDefault();
    if (deltaX > 0) {
      this.plan.toggleDone(id);
    } else {
      this.reschedule.move(id);
    }
  }
}
