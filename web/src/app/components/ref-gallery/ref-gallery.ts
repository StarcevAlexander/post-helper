import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { REFS_TEXTS } from '../../constants';
import { RefFileMeta } from '../../models';
import { Refs } from '../../services/refs';

interface TileView {
  file: RefFileMeta;
  url?: string;
  failed: boolean;
}

@Component({
  selector: 'app-ref-gallery',
  styleUrl: './ref-gallery.scss',
  templateUrl: './ref-gallery.html',
})
export class RefGallery {
  readonly itemId = input.required<string>();
  readonly index = input<number>();
  readonly fromIndex = input<number>();

  private readonly refs = inject(Refs);
  protected readonly texts = REFS_TEXTS;
  protected readonly urls = signal<Record<string, string | null>>({});

  protected readonly status = computed(() => this.refs.byKey().get(this.itemId()));
  protected readonly tiles = computed<TileView[]>(() => {
    const urls = this.urls();
    const index = this.index();
    const fromIndex = this.fromIndex();
    return (this.status()?.files ?? [])
      .filter(
        (file) =>
          (index === undefined || file.index === index) &&
          (fromIndex === undefined || file.index >= fromIndex),
      )
      .map((file) => ({
        file,
        url: urls[file.id] ?? undefined,
        failed: urls[file.id] === null,
      }));
  });
  protected readonly showNotes = computed(() => this.fromIndex() === undefined);

  constructor() {
    effect(() => {
      for (const file of this.status()?.files ?? []) {
        if (!(file.id in this.urls())) {
          this.urls.update((current) => ({ ...current, [file.id]: null }));
          void this.load(file);
        }
      }
    });
  }

  private async load(file: RefFileMeta): Promise<void> {
    try {
      const url = await this.refs.urlFor(file);
      this.urls.update((current) => ({ ...current, [file.id]: url }));
    } catch {
      this.urls.update((current) => ({ ...current, [file.id]: null }));
    }
  }
}
