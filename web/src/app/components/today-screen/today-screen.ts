import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FORMAT_LABELS, REFS_TEXTS, TODAY_COPY_FEEDBACK_MS, TODAY_TEXTS } from '../../constants';
import { PlanItem, TodayCopyFeedback, TodayEntry, TodaySection } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Refs } from '../../services/refs';
import { Today } from '../../services/today';
import { copyText } from '../../utils/clipboard';
import { fromDateKey } from '../../utils/date-utils';
import { captionWithHashtags } from '../../utils/kit-text';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

@Component({
  selector: 'app-today-screen',
  styleUrl: './today-screen.scss',
  templateUrl: './today-screen.html',
})
export class TodayScreen {
  readonly calendarRequested = output();

  protected readonly today = inject(Today);
  protected readonly plan = inject(CalendarPlan);
  protected readonly kits = inject(Kits);
  protected readonly refs = inject(Refs);
  protected readonly texts = TODAY_TEXTS;
  protected readonly feedback = signal<TodayCopyFeedback | undefined>(undefined);

  protected readonly sections = computed<TodaySection[]>(() => {
    const next = this.today.nextItem();
    const sections: TodaySection[] = [
      this.section('today', TODAY_TEXTS.todaySection, this.today.todayItems()),
      this.section('next', TODAY_TEXTS.nextSection, next ? [next] : []),
      this.section('overdue', TODAY_TEXTS.overdueSection, this.today.overdueItems()),
    ];
    return sections.filter((section) => section.entries.length > 0);
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.today.open() && !element.open) {
        element.showModal();
      } else if (!this.today.open() && element.open) {
        element.close();
      }
    });
  }

  protected feedbackText(id: string): string {
    const current = this.feedback();
    if (current?.id !== id) {
      return '';
    }
    return current.ok ? TODAY_TEXTS.copied : TODAY_TEXTS.copyFailed;
  }

  protected async onCopyCaption(entry: TodayEntry): Promise<void> {
    const kit = this.kits.kitFor(entry.item);
    if (!kit) {
      return;
    }
    const ok = await copyText(captionWithHashtags(kit));
    clearTimeout(this.feedbackTimer);
    this.feedback.set({ id: entry.item.id, ok });
    this.feedbackTimer = setTimeout(() => this.feedback.set(undefined), TODAY_COPY_FEEDBACK_MS);
  }

  protected onOpenCalendar(): void {
    this.today.close();
    this.calendarRequested.emit();
  }

  protected onClose(): void {
    this.today.close();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.today.close();
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.today.close();
    }
  }

  private section(kind: TodaySection['kind'], title: string, items: PlanItem[]): TodaySection {
    return { kind, title, entries: items.map((item) => this.entry(item)) };
  }

  private entry(item: PlanItem): TodayEntry {
    const ref = this.refs.byKey().get(item.id);
    return {
      item,
      whenLabel: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time}`,
      formatLabel: FORMAT_LABELS[item.format],
      status: this.kits.statusOf(item),
      error: this.kits.errorOf(item),
      refLabel:
        ref?.status === 'done'
          ? ref.stale
            ? REFS_TEXTS.stale
            : `${REFS_TEXTS.open} (${ref.files.length})`
          : undefined,
      refStale: ref?.stale ?? false,
    };
  }
}
