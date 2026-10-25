import { Component, computed, inject, input } from '@angular/core';
import {
  CONTENT_DAY_WEEK_LABEL,
  DAY_FORMAT,
  FORMAT_LABELS,
  KIT_FRAME_LABELS,
  KIT_OVERLAY_LABEL,
  KIT_VISUAL_LABEL,
  RANGE_FORMAT,
  SHOOT_TEXTS,
  WEEK_LABEL,
} from '../../constants';
import { PlanItem, ShootEntry, ShootUnit, ShootWeekView } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { ShootProgress } from '../../services/shoot-progress';
import { fromDateKey } from '../../utils/date-utils';
import { RefGallery } from '../ref-gallery/ref-gallery';

@Component({
  imports: [RefGallery],
  selector: 'app-shoot-screen',
  styleUrl: './shoot-screen.scss',
  templateUrl: './shoot-screen.html',
})
export class ShootScreen {
  readonly week = input.required<string>();

  private readonly plan = inject(CalendarPlan);
  private readonly kits = inject(Kits);
  protected readonly progress = inject(ShootProgress);

  protected readonly texts = SHOOT_TEXTS;
  protected readonly visualLabel = KIT_VISUAL_LABEL;
  protected readonly overlayLabel = KIT_OVERLAY_LABEL;

  protected readonly view = computed<ShootWeekView | undefined>(() => {
    const week = this.plan.weeks()[Number(this.week())];
    if (!week) {
      return undefined;
    }
    const entries = [...week.items]
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .map((item): ShootEntry => this.entryFor(item));
    return {
      heading: `${WEEK_LABEL} ${week.index + 1}, ${RANGE_FORMAT.format(fromDateKey(week.from))} – ${RANGE_FORMAT.format(fromDateKey(week.to))}`,
      contentDays: week.contentDays.map(
        (day) =>
          `${CONTENT_DAY_WEEK_LABEL}: ${DAY_FORMAT.format(fromDateKey(day.date))}, ${day.time}`,
      ),
      entries,
    };
  });

  protected toggleReady(entry: ShootEntry): void {
    const ready = !this.progress.isDone(entry.readyMark);
    this.progress.set([entry.readyMark, ...entry.marks], ready);
  }

  protected doneCount(entry: ShootEntry): number {
    return entry.marks.filter((mark) => this.progress.isDone(mark)).length;
  }

  private entryFor(item: PlanItem): ShootEntry {
    const kit = this.kits.kitFor(item);
    const frameLabel = KIT_FRAME_LABELS[item.format];
    const shots = (kit?.shots ?? []).map((text, index): ShootUnit => ({
      mark: `${item.id}:shot:${index}`,
      index,
      title: `${this.texts.shotUnit} ${index + 1}`,
      lines: [{ text }],
    }));
    const frames = (kit?.frames ?? []).map((frame, index): ShootUnit => ({
      mark: `${item.id}:frame:${index}`,
      index,
      title: `${frameLabel} ${index + 1}`,
      lines: [
        ...(frame.visual ? [{ label: this.visualLabel, text: frame.visual }] : []),
        ...(frame.overlay ? [{ label: this.overlayLabel, text: frame.overlay }] : []),
      ],
    }));
    const units = frames.length > 0 ? frames : shots;
    return {
      item,
      title: `${FORMAT_LABELS[item.format]}: ${item.idea}`,
      when: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time} · ${item.pillar}`,
      units,
      readyMark: `${item.id}:ready`,
      marks: units.map((unit) => unit.mark),
    };
  }
}
