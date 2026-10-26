import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DAY_FORMAT,
  FORMAT_LABELS,
  MEDIA_FEEDBACK_MS,
  MEDIA_FORMAT_RATIOS,
  MEDIA_TEXTS,
} from '../../constants';
import { MediaContentView, MediaStatus, MediaTileLoad } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { copyText } from '../../utils/clipboard';
import { fromDateKey } from '../../utils/date-utils';
import { captionWithHashtags } from '../../utils/kit-text';
import { MediaNote } from '../media-note/media-note';
import { MediaCapture } from '../media-capture/media-capture';

@Component({
  imports: [MediaCapture, MediaNote, RouterLink],
  selector: 'app-content-screen',
  styleUrl: './content-screen.scss',
  templateUrl: './content-screen.html',
})
export class ContentScreen {
  readonly id = input.required<string>();

  protected readonly media = inject(Media);
  private readonly plan = inject(CalendarPlan);
  private readonly kits = inject(Kits);
  protected readonly texts = MEDIA_TEXTS;
  protected readonly canShare =
    typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  protected readonly loads = signal<Record<string, MediaTileLoad>>({});
  protected readonly posters = signal<Record<string, string>>({});
  protected readonly confirming = signal<string | undefined>(undefined);
  protected readonly feedback = signal('');

  protected readonly item = computed(() =>
    this.plan.items().find((candidate) => candidate.id === this.id()),
  );
  protected readonly heading = computed(() => {
    const item = this.item();
    return item ? `${FORMAT_LABELS[item.format]}: ${item.idea}` : this.texts.contentTitle;
  });
  protected readonly subheading = computed(() => {
    const item = this.item();
    return item
      ? `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time} · ${item.pillar}`
      : '';
  });
  protected readonly shootWeek = computed(
    () => this.plan.weeks().find((week) => week.items.some((item) => item.id === this.id()))?.index,
  );
  protected readonly caption = computed(() => {
    const item = this.item();
    const kit = item ? this.kits.kitFor(item) : undefined;
    return kit ? captionWithHashtags(kit) : '';
  });
  protected readonly salesCaption = computed(() => {
    const done = this.statuses()
      .filter((status) => status.status === 'done' && status.result?.caption)
      .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt));
    return done[0]?.result?.caption ?? '';
  });
  protected readonly salesText = computed(() => {
    const item = this.item();
    const kit = item ? this.kits.kitFor(item) : undefined;
    return [this.salesCaption(), kit?.hashtags.join(' ')].filter(Boolean).join('\n\n');
  });
  protected readonly statuses = computed(() => this.media.byKey().get(this.id()) ?? []);
  protected readonly entries = computed<MediaContentView[]>(() => {
    const loads = this.loads();
    const posters = this.posters();
    return this.statuses().map((status) => ({
      status,
      label: this.labelFor(status),
      fileName: this.media.fileNameFor(status),
      ratio: status.result
        ? `${status.result.width} / ${status.result.height}`
        : MEDIA_FORMAT_RATIOS[status.format],
      media: loads[status.id] ?? { state: 'loading' },
      poster: posters[status.id],
    }));
  });
  protected readonly hasUploads = computed(() =>
    this.media.uploads().some((upload) => upload.key === this.id()),
  );

  private feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.media.error.set(undefined);
    effect(() => {
      const done = this.statuses().filter((status) => status.status === 'done');
      untracked(() => {
        for (const status of done) {
          if (!(status.id in this.loads())) {
            void this.load(status);
          }
        }
      });
    });
  }

  protected retry(status: MediaStatus): void {
    void this.load(status);
  }

  protected async onSave(status: MediaStatus): Promise<void> {
    try {
      const result = await this.media.save(status);
      this.showFeedback(result === 'cancelled' ? '' : this.texts.saved);
    } catch {
      this.showFeedback(this.texts.saveFailed);
    }
  }

  protected async onCopySales(): Promise<void> {
    this.showFeedback(
      (await copyText(this.salesText())) ? this.texts.copied : this.texts.copyFailed,
    );
  }

  protected async onCopyCaption(): Promise<void> {
    this.showFeedback((await copyText(this.caption())) ? this.texts.copied : this.texts.copyFailed);
  }

  protected askRemove(id: string): void {
    this.confirming.set(id);
  }

  protected cancelRemove(): void {
    this.confirming.set(undefined);
  }

  protected async onRemove(id: string): Promise<void> {
    this.confirming.set(undefined);
    await this.media.remove(id);
  }

  private labelFor(status: MediaStatus): string {
    switch (status.status) {
      case 'queued':
        return this.texts.queued;
      case 'running':
        return this.texts.running;
      case 'done':
        return status.result?.note || this.texts.done;
      case 'failed':
        return status.error ? `${this.texts.failed}: ${status.error}` : this.texts.failed;
    }
  }

  private async load(status: MediaStatus): Promise<void> {
    this.setLoad(status.id, { state: 'loading' });
    if (status.kind === 'video' && status.result?.thumb) {
      void this.media.thumbUrlFor(status).then(
        (url) => this.posters.update((current) => ({ ...current, [status.id]: url })),
        () => undefined,
      );
    }
    try {
      this.setLoad(status.id, { state: 'ready', url: await this.media.urlFor(status) });
    } catch {
      this.setLoad(status.id, { state: 'failed' });
    }
  }

  private setLoad(id: string, load: MediaTileLoad): void {
    this.loads.update((current) => ({ ...current, [id]: load }));
  }

  private showFeedback(text: string): void {
    clearTimeout(this.feedbackTimer);
    this.feedback.set(text);
    this.feedbackTimer = setTimeout(() => this.feedback.set(''), MEDIA_FEEDBACK_MS);
  }
}
