import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { REFS_TEXTS } from '../../constants';
import { RefFileMeta, RefTileLoad, RefTileView } from '../../models';
import { Refs } from '../../services/refs';

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
  protected readonly loads = signal<Record<string, RefTileLoad>>({});

  protected readonly status = computed(() => this.refs.byKey().get(this.itemId()));
  protected readonly tiles = computed<RefTileView[]>(() => {
    const loads = this.loads();
    const index = this.index();
    const fromIndex = this.fromIndex();
    return (this.status()?.files ?? [])
      .filter(
        (file) =>
          (index === undefined || file.index === index) &&
          (fromIndex === undefined || file.index >= fromIndex),
      )
      .map((file) => ({ file, load: loads[file.id] ?? { state: 'loading' } }));
  });
  protected readonly showNotes = computed(() => this.fromIndex() === undefined);

  constructor() {
    effect(() => {
      const files = this.status()?.files ?? [];
      untracked(() => {
        for (const file of files) {
          if (!(file.id in this.loads())) {
            void this.load(file);
          }
        }
      });
    });
  }

  protected retry(file: RefFileMeta): void {
    void this.load(file);
  }

  private async load(file: RefFileMeta): Promise<void> {
    this.setLoad(file.id, { state: 'loading' });
    try {
      this.setLoad(file.id, { state: 'ready', url: await this.refs.urlFor(file) });
    } catch {
      this.setLoad(file.id, { state: 'failed' });
    }
  }

  private setLoad(id: string, load: RefTileLoad): void {
    this.loads.update((current) => ({ ...current, [id]: load }));
  }
}
