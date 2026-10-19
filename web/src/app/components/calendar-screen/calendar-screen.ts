import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { form, FormField, validate } from '@angular/forms/signals';
import {
  BUILD_PLAN_LABEL,
  CALENDAR_CLOSE_LABEL,
  CALENDAR_HINT,
  CALENDAR_TITLE,
  CONTENT_DAY_FIRST_LABEL,
  CONTENT_DAY_SECOND_LABEL,
  CONTENT_DAY_TITLE,
  CONTENT_DAY_WEEK_LABEL,
  DONE_LABEL,
  EXPORT_HINT,
  EXPORT_LABEL,
  FORMAT_LABELS,
  ICS_FILE_NAME,
  NO_SECOND_DAY_LABEL,
  PLAN_EMPTY_TEXT,
  PLAN_TITLE,
  PUBLISH_TIME_LABEL,
  REBUILD_PLAN_LABEL,
  SAME_DAY_ERROR_TEXT,
  TIME_ERROR_TEXT,
  TIME_LABEL,
  TIME_PATTERN,
  WEEKDAY_NAMES,
  WEEK_LABEL,
} from '../../constants';
import { PlanItem, ScheduleDraft } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Onboarding } from '../../services/onboarding';
import { buildIcs } from '../../utils/ics-builder';
import { fromDateKey } from '../../utils/date-utils';

interface ItemView {
  item: PlanItem;
  dayLabel: string;
  formatLabel: string;
}

interface WeekView {
  index: number;
  title: string;
  contentDays: string[];
  items: ItemView[];
}

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const RANGE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

@Component({
  imports: [FormField],
  selector: 'app-calendar-screen',
  styleUrl: './calendar-screen.scss',
  templateUrl: './calendar-screen.html',
})
export class CalendarScreen {
  readonly open = model(false);

  protected readonly plan = inject(CalendarPlan);
  protected readonly onboarding = inject(Onboarding);
  protected readonly title = CALENDAR_TITLE;
  protected readonly hint = CALENDAR_HINT;
  protected readonly closeLabel = CALENDAR_CLOSE_LABEL;
  protected readonly contentDayTitle = CONTENT_DAY_TITLE;
  protected readonly firstDayLabel = CONTENT_DAY_FIRST_LABEL;
  protected readonly secondDayLabel = CONTENT_DAY_SECOND_LABEL;
  protected readonly noSecondDayLabel = NO_SECOND_DAY_LABEL;
  protected readonly timeLabel = TIME_LABEL;
  protected readonly publishTimeLabel = PUBLISH_TIME_LABEL;
  protected readonly planTitle = PLAN_TITLE;
  protected readonly emptyText = PLAN_EMPTY_TEXT;
  protected readonly doneLabel = DONE_LABEL;
  protected readonly exportLabel = EXPORT_LABEL;
  protected readonly exportHint = EXPORT_HINT;
  protected readonly weekdays = WEEKDAY_NAMES.map((name, index) => ({
    value: String(index),
    name,
  }));

  protected readonly draft = signal<ScheduleDraft>(this.plan.toDraft());
  protected readonly calendarForm = form(this.draft, (path) => {
    validate(path.time1, ({ value }) =>
      TIME_PATTERN.test(value()) ? undefined : { kind: 'time', message: TIME_ERROR_TEXT },
    );
    validate(path.publishTime, ({ value }) =>
      TIME_PATTERN.test(value()) ? undefined : { kind: 'time', message: TIME_ERROR_TEXT },
    );
    validate(path.weekday2, ({ value, valueOf }) =>
      value() !== '' && value() === valueOf(path.weekday1)
        ? { kind: 'sameDay', message: SAME_DAY_ERROR_TEXT }
        : undefined,
    );
    validate(path.time2, ({ value, valueOf }) =>
      valueOf(path.weekday2) !== '' && !TIME_PATTERN.test(value())
        ? { kind: 'time', message: TIME_ERROR_TEXT }
        : undefined,
    );
  });

  protected readonly buildLabel = computed(() =>
    this.plan.hasPlan() ? REBUILD_PLAN_LABEL : BUILD_PLAN_LABEL,
  );
  protected readonly weekViews = computed<WeekView[]>(() =>
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
      })),
    })),
  );

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) {
        untracked(() => this.draft.set(this.plan.toDraft()));
        element.showModal();
      } else if (!this.open() && element.open) {
        element.close();
      }
    });
  }

  protected errorOf(field: keyof ScheduleDraft): string | undefined {
    return this.calendarForm[field]().errors()[0]?.message;
  }

  protected onBuild(): void {
    const strategy = this.onboarding.strategy();
    if (!strategy || this.calendarForm().invalid()) {
      return;
    }
    this.plan.build(this.draft(), strategy);
  }

  protected onExport(): void {
    const text = buildIcs(this.plan.icsEvents());
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = ICS_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.open.set(false);
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.open.set(false);
    }
  }
}
