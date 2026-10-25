import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DAY_FORMAT,
  FORMAT_LABELS,
  IDEA_REQUEST_TEXTS,
  PUSH_TEXTS,
  REFS_TEXTS,
  RESCHEDULE_TEXTS,
  SHOOT_TEXTS,
  TODAY_COPY_FEEDBACK_MS,
  TODAY_TEXTS,
} from '../../constants';
import {
  PlanItem,
  RescheduleResult,
  TodayCopyFeedback,
  TodayEntry,
  TodaySection,
} from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { IdeaRequests } from '../../services/idea-requests';
import { Kits } from '../../services/kits';
import { PushNotifications } from '../../services/push-notifications';
import { Refs } from '../../services/refs';
import { Reschedule } from '../../services/reschedule';
import { Today } from '../../services/today';
import { copyText } from '../../utils/clipboard';
import { fromDateKey } from '../../utils/date-utils';
import { captionWithHashtags } from '../../utils/kit-text';

@Component({
  imports: [RouterLink],
  selector: 'app-today-screen',
  styleUrl: './today-screen.scss',
  templateUrl: './today-screen.html',
})
export class TodayScreen {
  protected readonly today = inject(Today);
  protected readonly plan = inject(CalendarPlan);
  protected readonly kits = inject(Kits);
  protected readonly refs = inject(Refs);
  protected readonly push = inject(PushNotifications);
  protected readonly reschedule = inject(Reschedule);
  protected readonly ideas = inject(IdeaRequests);
  protected readonly texts = TODAY_TEXTS;
  protected readonly shootTexts = SHOOT_TEXTS;
  protected readonly pushTexts = PUSH_TEXTS;
  protected readonly moveTexts = RESCHEDULE_TEXTS;
  protected readonly ideaTexts = IDEA_REQUEST_TEXTS;
  protected readonly offerPush = computed(
    () => this.push.supported && !this.push.subscribed() && !this.push.dismissed(),
  );
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

  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.today.refresh();
  }

  protected onEnablePush(): void {
    void this.push.enable();
  }

  protected onDismissPush(): void {
    this.push.dismiss();
  }

  protected feedbackText(id: string): string {
    const current = this.feedback();
    if (current?.id !== id) {
      return '';
    }
    return current.ok ? TODAY_TEXTS.copied : TODAY_TEXTS.copyFailed;
  }

  protected movedLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.movedFrom} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  protected returnLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.undoTo} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  protected moveLabel(last: RescheduleResult): string {
    return this.reschedule.describe(last);
  }

  protected async onCopyCaption(entry: TodayEntry): Promise<void> {
    if (!entry.captionText) {
      return;
    }
    const ok = await copyText(entry.captionText);
    clearTimeout(this.feedbackTimer);
    this.feedback.set({ id: entry.item.id, ok });
    this.feedbackTimer = setTimeout(() => this.feedback.set(undefined), TODAY_COPY_FEEDBACK_MS);
  }

  private section(kind: TodaySection['kind'], title: string, items: PlanItem[]): TodaySection {
    return { kind, title, entries: items.map((item) => this.entry(item)) };
  }

  private entry(item: PlanItem): TodayEntry {
    const ref = this.refs.byKey().get(item.id);
    const kit = this.kits.kitFor(item);
    return {
      item,
      whenLabel: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time}`,
      formatLabel: FORMAT_LABELS[item.format],
      hasKit: kit !== undefined,
      captionText: kit ? captionWithHashtags(kit) || undefined : undefined,
      refLabel:
        ref?.status === 'done'
          ? ref.stale
            ? REFS_TEXTS.stale
            : `${REFS_TEXTS.open} (${ref.files.length})`
          : undefined,
      refStale: ref?.stale ?? false,
      ideaRequested: this.ideas.requested(item),
    };
  }
}
