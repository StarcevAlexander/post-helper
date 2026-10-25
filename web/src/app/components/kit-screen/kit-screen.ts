import { Component, computed, inject, input, signal } from '@angular/core';
import {
  DAY_FORMAT,
  FORMAT_LABELS,
  KIT_COPIED_LABEL,
  KIT_COPY_CAPTION_LABEL,
  KIT_COPY_FAILED_LABEL,
  KIT_COPY_FEEDBACK_MS,
  KIT_FRAME_LABELS,
  KIT_MISSING_TEXT,
  KIT_OVERLAY_LABEL,
  KIT_SECTIONS,
  KIT_VISUAL_LABEL,
} from '../../constants';
import { KitCopyResult } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { copyText } from '../../utils/clipboard';
import { fromDateKey } from '../../utils/date-utils';
import { captionWithHashtags } from '../../utils/kit-text';

@Component({
  selector: 'app-kit-screen',
  styleUrl: './kit-screen.scss',
  templateUrl: './kit-screen.html',
})
export class KitScreen {
  readonly id = input.required<string>();

  protected readonly kits = inject(Kits);
  protected readonly plan = inject(CalendarPlan);
  protected readonly sections = KIT_SECTIONS;
  protected readonly overlayLabel = KIT_OVERLAY_LABEL;
  protected readonly visualLabel = KIT_VISUAL_LABEL;
  protected readonly missingText = KIT_MISSING_TEXT;
  protected readonly copyCaptionLabel = KIT_COPY_CAPTION_LABEL;
  protected readonly copied = signal<KitCopyResult | undefined>(undefined);

  protected readonly item = computed(() =>
    this.plan.items().find((candidate) => candidate.id === this.id()),
  );
  protected readonly kit = computed(() => {
    const item = this.item();
    return item ? this.kits.kitFor(item) : undefined;
  });
  protected readonly heading = computed(() => {
    const item = this.item();
    return item ? `${FORMAT_LABELS[item.format]}: ${item.idea}` : '';
  });
  protected readonly subheading = computed(() => {
    const item = this.item();
    return item
      ? `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time} · ${item.pillar}`
      : '';
  });
  protected readonly frameLabel = computed(() => {
    const item = this.item();
    return item ? KIT_FRAME_LABELS[item.format] : '';
  });
  protected readonly copyFeedback = computed(() => {
    switch (this.copied()) {
      case 'failed':
        return KIT_COPY_FAILED_LABEL;
      case undefined:
        return '';
      default:
        return KIT_COPIED_LABEL;
    }
  });

  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  protected async onCopyCaption(): Promise<void> {
    const kit = this.kit();
    if (kit) {
      this.showCopyResult(await copyText(captionWithHashtags(kit)), 'caption');
    }
  }

  private showCopyResult(success: boolean, kind: Exclude<KitCopyResult, 'failed'>): void {
    clearTimeout(this.copyTimer);
    this.copied.set(success ? kind : 'failed');
    this.copyTimer = setTimeout(() => this.copied.set(undefined), KIT_COPY_FEEDBACK_MS);
  }
}
