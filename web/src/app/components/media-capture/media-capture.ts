import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MEDIA_ACCEPT, MEDIA_TEXTS } from '../../constants';
import { MediaEntryView, MediaStatus, MediaTileLoad, MediaUpload, PlanItem } from '../../models';
import { Media } from '../../services/media';

@Component({
  imports: [RouterLink],
  selector: 'app-media-capture',
  styleUrl: './media-capture.scss',
  templateUrl: './media-capture.html',
})
export class MediaCapture {
  readonly item = input.required<PlanItem>();
  readonly unit = input.required<string>();
  readonly overlay = input.required<string>();
  readonly note = input('');
  readonly listStored = input(true);

  private readonly media = inject(Media);
  protected readonly texts = MEDIA_TEXTS;
  protected readonly accept = MEDIA_ACCEPT;
  protected readonly thumbs = signal<Record<string, MediaTileLoad>>({});

  private readonly statuses = computed(() =>
    (this.media.byKey().get(this.item().id) ?? []).filter((status) => status.unit === this.unit()),
  );

  protected readonly tiles = computed<MediaEntryView[]>(() => {
    const thumbs = this.thumbs();
    const key = this.item().id;
    const unit = this.unit();
    const uploading = this.media
      .uploads()
      .filter((upload) => upload.key === key && upload.unit === unit)
      .map((upload) => this.uploadTile(upload));
    const stored = this.listStored()
      ? this.statuses().map((status) => this.statusTile(status, thumbs))
      : [];
    return [...stored, ...uploading];
  });

  constructor() {
    effect(() => {
      const done = this.statuses().filter(
        (status) => status.status === 'done' && status.result?.thumb,
      );
      untracked(() => {
        for (const status of done) {
          if (!(status.id in this.thumbs())) {
            void this.loadThumb(status);
          }
        }
      });
    });
  }

  protected async onPick(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    input.value = '';
    for (const file of files) {
      await this.media.upload(this.item(), file, this.unit(), this.overlay(), this.note());
    }
  }

  protected onRemove(tile: MediaEntryView): void {
    if (tile.status) {
      void this.media.remove(tile.status.id);
    } else {
      this.media.dismissUpload(tile.id);
    }
  }

  protected retryThumb(status: MediaStatus): void {
    void this.loadThumb(status);
  }

  private uploadTile(upload: MediaUpload): MediaEntryView {
    return {
      id: upload.id,
      state: upload.error ? 'failed' : 'uploading',
      label: upload.error
        ? `${this.texts.failed}: ${upload.error}`
        : `${this.texts.uploading} ${upload.progress} %`,
      progress: upload.progress,
      thumb: { state: 'loading' },
    };
  }

  private statusTile(status: MediaStatus, thumbs: Record<string, MediaTileLoad>): MediaEntryView {
    return {
      id: status.id,
      state: status.status,
      label: this.labelFor(status),
      status,
      thumb: thumbs[status.id] ?? { state: 'loading' },
    };
  }

  private labelFor(status: MediaStatus): string {
    switch (status.status) {
      case 'queued':
        return this.texts.queued;
      case 'running':
        return this.texts.running;
      case 'done':
        return this.texts.done;
      case 'failed':
        return status.error ? `${this.texts.failed}: ${status.error}` : this.texts.failed;
    }
  }

  private async loadThumb(status: MediaStatus): Promise<void> {
    this.setThumb(status.id, { state: 'loading' });
    try {
      this.setThumb(status.id, { state: 'ready', url: await this.media.thumbUrlFor(status) });
    } catch {
      this.setThumb(status.id, { state: 'failed' });
    }
  }

  private setThumb(id: string, load: MediaTileLoad): void {
    this.thumbs.update((current) => ({ ...current, [id]: load }));
  }
}
