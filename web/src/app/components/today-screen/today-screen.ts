import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DAY_FORMAT,
  FORMAT_LABELS,
  MEDIA_TEXTS,
  PUSH_TEXTS,
  RESCHEDULE_TEXTS,
  SHOOT_TEXTS,
  TODAY_TEXTS,
} from '../../constants';
import { PlanItem, RescheduleResult, TodaySection } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Media } from '../../services/media';
import { PushNotifications } from '../../services/push-notifications';
import { Reschedule } from '../../services/reschedule';
import { Today } from '../../services/today';
import { fromDateKey } from '../../utils/date-utils';

@Component({
  imports: [RouterLink],
  selector: 'app-today-screen',
  styleUrl: './today-screen.scss',
  templateUrl: './today-screen.html',
})
export class TodayScreen {
  protected readonly today = inject(Today);
  protected readonly plan = inject(CalendarPlan);
  protected readonly media = inject(Media);
  protected readonly push = inject(PushNotifications);
  protected readonly reschedule = inject(Reschedule);
  protected readonly texts = TODAY_TEXTS;
  protected readonly mediaTexts = MEDIA_TEXTS;
  protected readonly shootTexts = SHOOT_TEXTS;
  protected readonly pushTexts = PUSH_TEXTS;
  protected readonly moveTexts = RESCHEDULE_TEXTS;
  protected readonly offerPush = computed(
    () => this.push.supported && !this.push.subscribed() && !this.push.dismissed(),
  );
  protected readonly missedOpen = signal(false);

  protected readonly sections = computed<TodaySection[]>(() => {
    const next = this.today.nextItem();
    const sections: TodaySection[] = [
      this.section('today', TODAY_TEXTS.todaySection, this.today.todayItems()),
      this.section('next', TODAY_TEXTS.nextSection, next ? [next] : []),
      this.section('overdue', TODAY_TEXTS.overdueSection, this.today.overdueItems()),
    ];
    return sections.filter((section) => section.entries.length > 0);
  });

  constructor() {
    this.today.refresh();
  }

  protected onEnablePush(): void {
    void this.push.enable();
  }

  protected onDismissPush(): void {
    this.push.dismiss();
  }

  protected missedLabel(count: number): string {
    return `${TODAY_TEXTS.overdueSection} (${count})`;
  }

  protected toggleMissed(): void {
    this.missedOpen.update((open) => !open);
  }

  protected missedHidden(kind: TodaySection['kind']): boolean {
    return kind === 'overdue' && !this.missedOpen();
  }

  protected movedLabel(from: string): string {
    return `${RESCHEDULE_TEXTS.movedFrom} ${DAY_FORMAT.format(fromDateKey(from))}`;
  }

  protected moveLabel(last: RescheduleResult): string {
    return this.reschedule.describe(last);
  }

  private section(kind: TodaySection['kind'], title: string, items: PlanItem[]): TodaySection {
    return {
      kind,
      title,
      entries: items.map((item) => ({
        item,
        whenLabel: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time}`,
        formatLabel: FORMAT_LABELS[item.format],
        contentPending: this.media.contentPending(item.id),
      })),
    };
  }
}
