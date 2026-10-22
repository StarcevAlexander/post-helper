import { Component, ElementRef, computed, effect, inject, output, viewChild } from '@angular/core';
import {
  INTAKE_GOALS,
  INTAKE_MAX_LINKS,
  INTAKE_MAX_NOTE_LENGTH,
  INTAKE_MAX_REFERENCES,
  INTAKE_PLATFORM_LABELS,
  INTAKE_TEXTS,
} from '../../constants';
import { IntakeGoalId } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Intake } from '../../services/intake';
import { detectPlatform } from '../../utils/intake-links';

@Component({
  selector: 'app-intake-screen',
  styleUrl: './intake-screen.scss',
  templateUrl: './intake-screen.html',
})
export class IntakeScreen {
  protected readonly intake = inject(Intake);
  private readonly plan = inject(CalendarPlan);

  readonly calendarRequested = output<void>();

  protected readonly texts = INTAKE_TEXTS;
  protected readonly goals = INTAKE_GOALS;
  protected readonly maxLinks = INTAKE_MAX_LINKS;
  protected readonly maxReferences = INTAKE_MAX_REFERENCES;
  protected readonly maxNote = INTAKE_MAX_NOTE_LENGTH;
  protected readonly hasPlan = this.plan.hasPlan;
  protected readonly rows = computed(() =>
    this.intake.draft().links.map((url, index) => {
      const platform = detectPlatform(url);
      return { index, url, platformLabel: platform ? INTAKE_PLATFORM_LABELS[platform] : undefined };
    }),
  );
  protected readonly referenceRows = computed(() => {
    const references = this.intake.draft().references;
    return {
      filled: references.filter((url) => url.trim().length > 0).length,
      rows: references.map((url, index) => {
        const platform = detectPlatform(url);
        return {
          index,
          url,
          platformLabel: platform ? INTAKE_PLATFORM_LABELS[platform] : undefined,
        };
      }),
    };
  });
  protected readonly summary = computed(() => {
    const request = this.intake.request();
    return {
      references: (request?.references ?? []).map((network) => ({
        label: INTAKE_PLATFORM_LABELS[network.platform],
        url: network.url,
      })),
      networks: (request?.networks ?? []).map((network) => ({
        label: INTAKE_PLATFORM_LABELS[network.platform],
        url: network.url,
      })),
      goals: INTAKE_GOALS.filter((goal) => request?.goals.includes(goal.id)).map(
        (goal) => goal.label,
      ),
    };
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.intake.open() && !element.open) {
        element.showModal();
      } else if (!this.intake.open() && element.open) {
        element.close();
      }
    });
  }

  protected onLinkInput(index: number, event: Event): void {
    this.intake.setLink(index, (event.target as HTMLInputElement).value);
  }

  protected onReferenceInput(index: number, event: Event): void {
    this.intake.setReference(index, (event.target as HTMLInputElement).value);
  }

  protected onNoteInput(event: Event): void {
    this.intake.setNote((event.target as HTMLTextAreaElement).value);
  }

  protected isChosen(id: IntakeGoalId): boolean {
    return this.intake.draft().goals.includes(id);
  }

  protected async onSubmit(): Promise<void> {
    await this.intake.submit();
  }

  protected onOpenCalendar(): void {
    this.intake.hide();
    this.calendarRequested.emit();
  }

  protected onClose(): void {
    this.intake.hide();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.intake.hide();
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.intake.hide();
    }
  }
}
