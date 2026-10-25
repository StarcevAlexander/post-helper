import { Component, DestroyRef, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DAY_FORMAT,
  FORMAT_LABELS,
  IDEA_REQUEST_TEXTS,
  MAX_IDEA_REQUEST_TEXT,
} from '../../constants';
import { CalendarPlan } from '../../services/calendar-plan';
import { IdeaRequests } from '../../services/idea-requests';
import { fromDateKey } from '../../utils/date-utils';
import { fieldValue } from '../../utils/form-events';

@Component({
  imports: [RouterLink],
  selector: 'app-replace-idea-screen',
  styleUrl: './replace-idea-screen.scss',
  templateUrl: './replace-idea-screen.html',
})
export class ReplaceIdeaScreen {
  readonly id = input.required<string>();

  protected readonly ideas = inject(IdeaRequests);
  private readonly plan = inject(CalendarPlan);
  protected readonly texts = IDEA_REQUEST_TEXTS;
  protected readonly maxText = MAX_IDEA_REQUEST_TEXT;

  protected readonly item = computed(() =>
    this.plan.items().find((candidate) => candidate.id === this.id()),
  );
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
  protected readonly requested = computed(() => {
    const item = this.item();
    return item !== undefined && !this.ideas.sent() && this.ideas.requested(item);
  });

  constructor() {
    this.ideas.reset();
    inject(DestroyRef).onDestroy(() => this.ideas.reset());
  }

  protected onTextInput(event: Event): void {
    this.ideas.setText(fieldValue(event));
  }

  protected async onSubmit(): Promise<void> {
    const item = this.item();
    if (item) {
      await this.ideas.submit(item);
    }
  }
}
