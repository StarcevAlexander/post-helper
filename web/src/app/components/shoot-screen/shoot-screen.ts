import { Component, computed, inject, input } from '@angular/core';
import {
  CONTENT_DAY_WEEK_LABEL,
  FORMAT_LABELS,
  KIT_FRAME_LABELS,
  KIT_OVERLAY_LABEL,
  KIT_VISUAL_LABEL,
  SHOOT_TEXTS,
  WEEK_LABEL,
} from '../../constants';
import { PlanItem, PublicationKit } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { fromDateKey } from '../../utils/date-utils';
import { RefGallery } from '../ref-gallery/ref-gallery';

const DAY_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const RANGE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

interface ShootEntry {
  item: PlanItem;
  title: string;
  when: string;
  frameLabel: string;
  kit?: PublicationKit;
}

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

  protected readonly texts = SHOOT_TEXTS;
  protected readonly visualLabel = KIT_VISUAL_LABEL;
  protected readonly overlayLabel = KIT_OVERLAY_LABEL;

  protected readonly view = computed(() => {
    const week = this.plan.weeks()[Number(this.week())];
    if (!week) {
      return undefined;
    }
    const entries = [...week.items]
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
      .map((item): ShootEntry => ({
        item,
        title: `${FORMAT_LABELS[item.format]}: ${item.idea}`,
        when: `${DAY_FORMAT.format(fromDateKey(item.date))}, ${item.time} · ${item.pillar}`,
        frameLabel: KIT_FRAME_LABELS[item.format],
        kit: this.kits.kitFor(item),
      }));
    return {
      heading: `${WEEK_LABEL} ${week.index + 1}, ${RANGE_FORMAT.format(fromDateKey(week.from))} – ${RANGE_FORMAT.format(fromDateKey(week.to))}`,
      contentDays: week.contentDays.map(
        (day) =>
          `${CONTENT_DAY_WEEK_LABEL}: ${DAY_FORMAT.format(fromDateKey(day.date))}, ${day.time}`,
      ),
      entries,
    };
  });
}
