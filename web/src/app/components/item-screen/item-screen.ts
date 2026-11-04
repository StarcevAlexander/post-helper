import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DAY_FORMAT,
  FORMAT_LABELS,
  IDEA_REQUEST_TEXTS,
  KIT_OPEN_LABEL,
  KIT_PENDING_LABEL,
  MEDIA_TEXTS,
  REFS_TEXTS,
  RESCHEDULE_TEXTS,
  TODAY_COPY_FEEDBACK_MS,
  TODAY_TEXTS,
} from '../../constants';
import { ItemCopyFeedback, RefStatus } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { IdeaRequests } from '../../services/idea-requests';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { Refs } from '../../services/refs';
import { Reschedule } from '../../services/reschedule';
import { copyText } from '../../utils/clipboard';
import { fromDateKey } from '../../utils/date-utils';
import { captionWithHashtags } from '../../utils/kit-text';

@Component({
  imports: [RouterLink],
  selector: 'app-item-screen',
  styleUrl: './item-screen.scss',
  templateUrl: './item-screen.html',
})
export class ItemScreen {
  readonly id = input.required<string>();

  protected readonly plan = inject(CalendarPlan);
  protected readonly kits = inject(Kits);
  protected readonly refs = inject(Refs);
  protected readonly media = inject(Media);
  protected readonly reschedule = inject(Reschedule);
  protected readonly ideas = inject(IdeaRequests);

  protected readonly todayTexts = TODAY_TEXTS;
  protected readonly mediaTexts = MEDIA_TEXTS;
  protected readonly refsTexts = REFS_TEXTS;
  protected readonly moveTexts = RESCHEDULE_TEXTS;
  protected readonly ideaTexts = IDEA_REQUEST_TEXTS;
  protected readonly kitOpenLabel = KIT_OPEN_LABEL;
  protected readonly kitPendingLabel = KIT_PENDING_LABEL;

  protected readonly feedback = signal<ItemCopyFeedback | undefined>(undefined);
  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly view = computed(() => {
    const item = this.plan.items().find((candidate) => candidate.id === this.id());
    if (!item) {
      return undefined;
    }
    const ref = this.refs.byKey().get(item.id);
    const kit = this.kits.kitFor(item);
    return {
      item,
      whenLabel: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time}`,
      formatLabel: FORMAT_LABELS[item.format],
      hasKit: kit !== undefined,
      captionText: kit ? captionWithHashtags(kit) || undefined : undefined,
      refLabel: this.refLabel(ref),
      refStale: ref?.stale ?? false,
      contentLabel: this.media.contentLabel(item.id),
      contentPending: this.media.contentPending(item.id),
      ideaRequested: this.ideas.requested(item),
    };
  });

  protected movedLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.movedFrom} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  protected returnLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.undoTo} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  protected feedbackText(): string {
    const current = this.feedback();
    if (!current) {
      return '';
    }
    return current.ok ? TODAY_TEXTS.copied : TODAY_TEXTS.copyFailed;
  }

  protected async onCopyCaption(captionText: string): Promise<void> {
    const ok = await copyText(captionText);
    clearTimeout(this.feedbackTimer);
    this.feedback.set({ ok });
    this.feedbackTimer = setTimeout(() => this.feedback.set(undefined), TODAY_COPY_FEEDBACK_MS);
  }

  private refLabel(ref: RefStatus | undefined): string | undefined {
    switch (ref?.status) {
      case undefined:
        return undefined;
      case 'done':
        return ref.stale ? REFS_TEXTS.stale : `${REFS_TEXTS.open} (${ref.files.length})`;
      case 'failed':
        return REFS_TEXTS.failed;
      case 'made':
        return REFS_TEXTS.made;
      default:
        return REFS_TEXTS.making;
    }
  }
}
