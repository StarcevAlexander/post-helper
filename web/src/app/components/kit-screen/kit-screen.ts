import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import {
  FORMAT_LABELS,
  KIT_CLOSE_LABEL,
  KIT_COPIED_LABEL,
  KIT_COPY_ALL_LABEL,
  KIT_COPY_CAPTION_LABEL,
  KIT_COPY_FAILED_LABEL,
  KIT_COPY_FEEDBACK_MS,
  KIT_FRAME_LABELS,
  KIT_MISSING_TEXT,
  KIT_OVERLAY_LABEL,
  KIT_PREPARING_LABEL,
  KIT_REGENERATE_LABEL,
  KIT_SECTIONS,
  KIT_TITLE,
  KIT_VISUAL_LABEL,
} from '../../constants';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { copyText } from '../../utils/clipboard';
import { fromDateKey } from '../../utils/date-utils';
import { captionWithHashtags, fullKitText } from '../../utils/kit-text';

type CopyResult = 'caption' | 'all' | 'failed';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

@Component({
  selector: 'app-kit-screen',
  styleUrl: './kit-screen.scss',
  templateUrl: './kit-screen.html',
})
export class KitScreen {
  protected readonly kits = inject(Kits);
  protected readonly plan = inject(CalendarPlan);
  protected readonly title = KIT_TITLE;
  protected readonly closeLabel = KIT_CLOSE_LABEL;
  protected readonly sections = KIT_SECTIONS;
  protected readonly overlayLabel = KIT_OVERLAY_LABEL;
  protected readonly visualLabel = KIT_VISUAL_LABEL;
  protected readonly missingText = KIT_MISSING_TEXT;
  protected readonly copyCaptionLabel = KIT_COPY_CAPTION_LABEL;
  protected readonly copyAllLabel = KIT_COPY_ALL_LABEL;
  protected readonly regenerateLabel = KIT_REGENERATE_LABEL;
  protected readonly preparingLabel = KIT_PREPARING_LABEL;
  protected readonly copied = signal<CopyResult | undefined>(undefined);

  protected readonly item = computed(() =>
    this.plan.items().find((candidate) => candidate.id === this.kits.viewing()),
  );
  protected readonly kit = computed(() => {
    const item = this.item();
    return item ? this.kits.kitFor(item) : undefined;
  });
  protected readonly heading = computed(() => {
    const item = this.item();
    return item ? `${FORMAT_LABELS[item.format]}: ${item.idea}` : this.title;
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
  protected readonly loading = computed(() => {
    const item = this.item();
    return item ? this.kits.statusOf(item) === 'loading' : false;
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

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      const shown = this.kits.viewing() !== undefined;
      if (shown && !element.open) {
        element.showModal();
      } else if (!shown && element.open) {
        element.close();
      }
    });
  }

  protected async onCopyCaption(): Promise<void> {
    const kit = this.kit();
    if (kit) {
      this.showCopyResult(await copyText(captionWithHashtags(kit)), 'caption');
    }
  }

  protected async onCopyAll(): Promise<void> {
    const kit = this.kit();
    const item = this.item();
    if (kit && item) {
      this.showCopyResult(await copyText(fullKitText(this.heading(), item.format, kit)), 'all');
    }
  }

  protected onRegenerate(): void {
    const item = this.item();
    if (item) {
      void this.kits.generate(item);
    }
  }

  protected onClose(): void {
    this.kits.closeView();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.kits.closeView();
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.kits.closeView();
    }
  }

  private showCopyResult(success: boolean, kind: Exclude<CopyResult, 'failed'>): void {
    clearTimeout(this.copyTimer);
    this.copied.set(success ? kind : 'failed');
    this.copyTimer = setTimeout(() => this.copied.set(undefined), KIT_COPY_FEEDBACK_MS);
  }
}
