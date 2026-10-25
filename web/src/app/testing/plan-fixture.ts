import { PlanItem, PostFormat, StoredCalendar } from '../models';
import { addDays, toDateKey } from '../utils/date-utils';

interface FixtureSlot {
  day: number;
  format: PostFormat;
  idea: string;
  pillar: string;
}

const WEEK_SLOTS: readonly FixtureSlot[] = [
  { day: 1, format: 'reels', idea: 'Кадр до', pillar: 'До и после' },
  { day: 2, format: 'stories', idea: 'Свободно в пятницу', pillar: 'Окошки' },
  { day: 3, format: 'post', idea: 'Видео', pillar: 'Процесс' },
];

export function samplePlan(today: Date, weeks = 4, slots = WEEK_SLOTS): StoredCalendar {
  const start = addDays(today, 1);
  const items: PlanItem[] = [];
  for (let week = 0; week < weeks; week += 1) {
    slots.forEach((slot, index) => {
      const date = toDateKey(addDays(start, week * 7 + slot.day));
      items.push({
        id: `${date}-${slot.format}-${index}`,
        date,
        time: '19:00',
        format: slot.format,
        pillar: slot.pillar,
        idea: slot.idea,
        done: false,
      });
    });
  }
  return {
    startedOn: toDateKey(start),
    schedule: { slots: [{ weekday: 3, time: '18:00' }], publishTime: '19:00' },
    items,
  };
}
