import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FORMAT_LABELS, REFS_TEXTS } from '../../constants';
import { RefFileMeta } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Refs } from '../../services/refs';
import { fromDateKey } from '../../utils/date-utils';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

interface TileView {
  file: RefFileMeta;
  url?: string;
  failed: boolean;
}

@Component({
  selector: 'app-refs-screen',
  styleUrl: './refs-screen.scss',
  templateUrl: './refs-screen.html',
})
export class RefsScreen {
  protected readonly refs = inject(Refs);
  protected readonly plan = inject(CalendarPlan);
  protected readonly texts = REFS_TEXTS;
  protected readonly urls = signal<Record<string, string | null>>({});

  protected readonly item = computed(() =>
    this.plan.items().find((candidate) => candidate.id === this.refs.viewing()),
  );
  protected readonly status = computed(() => {
    const key = this.refs.viewing();
    return key === undefined ? undefined : this.refs.byKey().get(key);
  });
  protected readonly heading = computed(() => {
    const item = this.item();
    return item ? `${FORMAT_LABELS[item.format]}: ${item.idea}` : this.texts.title;
  });
  protected readonly subheading = computed(() => {
    const item = this.item();
    return item
      ? `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time} · ${item.pillar}`
      : '';
  });
  protected readonly tiles = computed<TileView[]>(() => {
    const urls = this.urls();
    return (this.status()?.files ?? []).map((file) => ({
      file,
      url: urls[file.id] ?? undefined,
      failed: urls[file.id] === null,
    }));
  });
  protected readonly canConfirm = computed(() => {
    const state = this.status()?.status;
    return state !== undefined && state !== 'made' && state !== 'running';
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirm');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      const shown = this.refs.viewing() !== undefined;
      if (shown && !element.open) {
        element.showModal();
      } else if (!shown && element.open) {
        this.confirmDialog().nativeElement.close();
        element.close();
      }
    });

    effect(() => {
      for (const file of this.status()?.files ?? []) {
        if (!(file.id in this.urls())) {
          this.urls.update((current) => ({ ...current, [file.id]: null }));
          void this.load(file);
        }
      }
    });
  }

  protected onAskConfirm(): void {
    this.confirmDialog().nativeElement.showModal();
  }

  protected onCancel(): void {
    this.confirmDialog().nativeElement.close();
  }

  protected async onOk(): Promise<void> {
    this.confirmDialog().nativeElement.close();
    const key = this.refs.viewing();
    if (key !== undefined && (await this.refs.confirmMade(key))) {
      this.refs.hide();
    }
  }

  protected onClose(): void {
    this.refs.hide();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.refs.hide();
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.refs.hide();
    }
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
