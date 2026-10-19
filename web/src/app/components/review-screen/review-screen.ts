import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { form, FormField, validate } from '@angular/forms/signals';
import { MAX_INQUIRIES, REVIEW_TEXTS } from '../../constants';
import { ReviewAnswers } from '../../models';
import { Reviews } from '../../services/reviews';
import { fromDateKey } from '../../utils/date-utils';

const RANGE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

@Component({
  imports: [FormField],
  selector: 'app-review-screen',
  styleUrl: './review-screen.scss',
  templateUrl: './review-screen.html',
})
export class ReviewScreen {
  protected readonly reviews = inject(Reviews);
  protected readonly texts = REVIEW_TEXTS;
  protected readonly editing = signal(false);
  protected readonly model = signal({ inquiries: '', bestIdea: '', hard: '' });
  protected readonly reviewForm = form(this.model, (path) => {
    validate(path.inquiries, ({ value }) => {
      const text = value().trim();
      if (text === '') {
        return undefined;
      }
      return /^\d{1,6}$/.test(text) && Number(text) <= MAX_INQUIRIES
        ? undefined
        : { kind: 'number', message: REVIEW_TEXTS.numberError };
    });
  });

  protected readonly week = computed(() => this.reviews.viewing());
  protected readonly saved = computed(() => {
    const week = this.week();
    return week ? this.reviews.forWeek(week.from) : undefined;
  });
  protected readonly showForm = computed(() => this.saved() === undefined || this.editing());
  protected readonly subtitle = computed(() => {
    const week = this.week();
    return week
      ? `${RANGE_FORMAT.format(fromDateKey(week.from))} – ${RANGE_FORMAT.format(fromDateKey(week.to))}`
      : '';
  });
  protected readonly options = computed(() => {
    const week = this.week();
    return week ? [...new Set(week.items.map((item) => item.idea))] : [];
  });
  protected readonly submitLabel = computed(() =>
    this.reviews.busy()
      ? REVIEW_TEXTS.working
      : this.saved()
        ? REVIEW_TEXTS.submitAgain
        : REVIEW_TEXTS.submit,
  );
  protected readonly canSubmit = computed(
    () => !this.reviews.busy() && this.reviewForm.inquiries().errors().length === 0,
  );

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      const shown = this.reviews.viewing() !== undefined;
      if (shown && !element.open) {
        this.editing.set(false);
        this.model.set({ inquiries: '', bestIdea: '', hard: '' });
        element.showModal();
      } else if (!shown && element.open) {
        element.close();
      }
    });
  }

  protected errorOf(): string | undefined {
    return this.reviewForm.inquiries().errors()[0]?.message;
  }

  protected async onSubmit(): Promise<void> {
    const week = this.week();
    if (!week || !this.canSubmit()) {
      return;
    }
    const value = this.model();
    const inquiries = value.inquiries.trim();
    const answers: ReviewAnswers = {
      bestIdea: value.bestIdea.trim(),
      hard: value.hard.trim(),
      ...(inquiries === '' ? {} : { inquiries: Number(inquiries) }),
    };
    if (await this.reviews.submit(week, answers)) {
      this.editing.set(false);
    }
  }

  protected onApply(): void {
    const week = this.week();
    if (week && this.reviews.apply(week.from)) {
      this.reviews.closeView();
    }
  }

  protected onEditAgain(): void {
    this.editing.set(true);
  }

  protected onClose(): void {
    this.reviews.closeView();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.reviews.closeView();
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.reviews.closeView();
    }
  }
}
