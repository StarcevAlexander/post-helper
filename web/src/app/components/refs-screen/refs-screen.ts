import { Component, ElementRef, computed, inject, input, viewChild } from '@angular/core';
import { DAY_FORMAT, FORMAT_LABELS, REFS_TEXTS } from '../../constants';
import { CalendarPlan } from '../../services/calendar-plan';
import { Navigation } from '../../services/navigation';
import { Refs } from '../../services/refs';
import { fromDateKey } from '../../utils/date-utils';
import { RefGallery } from '../ref-gallery/ref-gallery';

@Component({
  imports: [RefGallery],
  selector: 'app-refs-screen',
  styleUrl: './refs-screen.scss',
  templateUrl: './refs-screen.html',
})
export class RefsScreen {
  readonly id = input.required<string>();

  private readonly navigation = inject(Navigation);
  protected readonly refs = inject(Refs);
  protected readonly plan = inject(CalendarPlan);
  protected readonly texts = REFS_TEXTS;

  protected readonly item = computed(() =>
    this.plan.items().find((candidate) => candidate.id === this.id()),
  );
  protected readonly status = computed(() => this.refs.byKey().get(this.id()));
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
  protected readonly canConfirm = computed(() => {
    const state = this.status()?.status;
    return state !== undefined && state !== 'made' && state !== 'running';
  });

  private readonly confirmDialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirm');

  constructor() {
    this.refs.error.set(undefined);
  }

  protected onAskConfirm(): void {
    this.confirmDialog().nativeElement.showModal();
  }

  protected onCancel(): void {
    this.confirmDialog().nativeElement.close();
  }

  protected async onOk(): Promise<void> {
    this.confirmDialog().nativeElement.close();
    if (await this.refs.confirmMade(this.id())) {
      this.navigation.back();
    }
  }
}
