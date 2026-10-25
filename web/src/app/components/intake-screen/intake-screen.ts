import { Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  INTAKE_GOALS,
  INTAKE_MAX_LINKS,
  INTAKE_MAX_NOTE_LENGTH,
  INTAKE_MAX_REFERENCES,
  INTAKE_PLATFORM_LABELS,
  INTAKE_SCHEDULE_TEXTS,
  INTAKE_TEXTS,
  MAX_BEST_POST_LENGTH,
  MONTH_REVIEW_INTAKE_TEXTS,
  MONTH_REVIEW_STATS_TEXTS,
  STAT_PATTERN,
  TIME_PATTERN,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
} from '../../constants';
import { IntakeGoalId, IntakeStatField, IntakeTimeField, WeekdayOption } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Intake } from '../../services/intake';
import { fieldValue } from '../../utils/form-events';
import { detectPlatform } from '../../utils/intake-links';

@Component({
  imports: [RouterLink],
  selector: 'app-intake-screen',
  styleUrl: './intake-screen.scss',
  templateUrl: './intake-screen.html',
})
export class IntakeScreen {
  protected readonly intake = inject(Intake);
  private readonly plan = inject(CalendarPlan);

  protected readonly texts = INTAKE_TEXTS;
  protected readonly reviewTexts = MONTH_REVIEW_INTAKE_TEXTS;
  protected readonly statsTexts = MONTH_REVIEW_STATS_TEXTS;
  protected readonly scheduleTexts = INTAKE_SCHEDULE_TEXTS;
  protected readonly weekdays: readonly WeekdayOption[] = WEEKDAY_SHORT_NAMES.map(
    (short, index) => ({ index, short, full: WEEKDAY_NAMES[index] }),
  );
  protected readonly goals = INTAKE_GOALS;
  protected readonly maxLinks = INTAKE_MAX_LINKS;
  protected readonly maxReferences = INTAKE_MAX_REFERENCES;
  protected readonly maxNote = INTAKE_MAX_NOTE_LENGTH;
  protected readonly maxBestPost = MAX_BEST_POST_LENGTH;
  protected readonly hasPlan = this.plan.hasPlan;
  protected readonly statLines = computed(() => {
    const stats = this.intake.request()?.stats;
    const lines: string[] = [];
    if (stats?.followers !== undefined) {
      lines.push(`${MONTH_REVIEW_STATS_TEXTS.followersLine}: ${stats.followers}`);
    }
    if (stats?.reach !== undefined) {
      lines.push(`${MONTH_REVIEW_STATS_TEXTS.reachLine}: ${stats.reach}`);
    }
    if (stats?.bestPost) {
      lines.push(`${MONTH_REVIEW_STATS_TEXTS.bestPostLine}: ${stats.bestPost}`);
    }
    return lines;
  });
  protected readonly scheduleLines = computed(() => {
    const schedule = this.intake.request()?.schedule;
    const lines: string[] = [];
    if (schedule?.shootDays.length) {
      const days = schedule.shootDays.map((day) => WEEKDAY_NAMES[day] ?? String(day)).join(', ');
      lines.push(`${INTAKE_SCHEDULE_TEXTS.shootDaysLine}: ${days}`);
    }
    if (schedule?.shootTime) {
      lines.push(`${INTAKE_SCHEDULE_TEXTS.shootTimeLine}: ${schedule.shootTime}`);
    }
    if (schedule?.publishTime) {
      lines.push(`${INTAKE_SCHEDULE_TEXTS.publishTimeLine}: ${schedule.publishTime}`);
    }
    return lines;
  });
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

  constructor() {
    inject(DestroyRef).onDestroy(() => this.intake.markSeen());
  }

  protected onLinkInput(index: number, event: Event): void {
    this.intake.setLink(index, fieldValue(event));
  }

  protected onReferenceInput(index: number, event: Event): void {
    this.intake.setReference(index, fieldValue(event));
  }

  protected onCityInput(event: Event): void {
    this.intake.setCity(fieldValue(event));
  }

  protected onNoteInput(event: Event): void {
    this.intake.setNote(fieldValue(event));
  }

  protected onStatInput(field: IntakeStatField, event: Event): void {
    this.intake.setStat(field, fieldValue(event));
  }

  protected statInvalid(field: Exclude<IntakeStatField, 'bestPost'>): true | undefined {
    const value = this.intake.draft().stats[field].trim();
    return value !== '' && !STAT_PATTERN.test(value) ? true : undefined;
  }

  protected isChosen(id: IntakeGoalId): boolean {
    return this.intake.draft().goals.includes(id);
  }

  protected isShootDay(day: number): boolean {
    return this.intake.draft().schedule.shootDays.includes(day);
  }

  protected onTimeInput(field: IntakeTimeField, event: Event): void {
    this.intake.setTime(field, fieldValue(event));
  }

  protected timeInvalid(field: IntakeTimeField): true | undefined {
    const value = this.intake.draft().schedule[field];
    return value !== '' && !TIME_PATTERN.test(value) ? true : undefined;
  }

  protected async onSubmit(): Promise<void> {
    await this.intake.submit();
  }
}
