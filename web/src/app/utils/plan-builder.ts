import {
  DEFAULT_CADENCE,
  FORMAT_ORDER,
  GENERIC_PILLAR_TITLE,
  MAX_PER_WEEK,
  PLAN_WEEKS,
} from '../constants';
import { PlanItem, PostFormat, Strategy, StrategyCadence, StrategyPillar } from '../models';
import { addDays, toDateKey } from './date-utils';

interface Placement {
  format: PostFormat;
  day: number;
}

function clampCount(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_PER_WEEK, Math.max(0, Math.round(value))) : 0;
}

function normalizeCadence(cadence: StrategyCadence): StrategyCadence {
  const normalized = {
    ...cadence,
    reels: clampCount(cadence.reels),
    posts: clampCount(cadence.posts),
    stories: clampCount(cadence.stories),
  };
  return normalized.reels + normalized.posts + normalized.stories === 0
    ? DEFAULT_CADENCE
    : normalized;
}

function spreadDays(count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    Math.min(6, Math.floor(((index + 0.5) * 7) / count)),
  );
}

function mainFormats(reels: number, posts: number): PostFormat[] {
  const formats: PostFormat[] = [];
  let reelsLeft = reels;
  let postsLeft = posts;
  while (reelsLeft + postsLeft > 0) {
    if (reelsLeft > 0 && (postsLeft === 0 || reelsLeft >= postsLeft)) {
      formats.push('reels');
      reelsLeft -= 1;
    } else {
      formats.push('post');
      postsLeft -= 1;
    }
  }
  return formats;
}

function placeWeek(cadence: StrategyCadence): Placement[] {
  const formats = mainFormats(cadence.reels, cadence.posts);
  const mainDays = spreadDays(formats.length);
  const storyDays = spreadDays(cadence.stories);
  return [
    ...formats.map((format, index) => ({ format, day: mainDays[index] })),
    ...storyDays.map((day): Placement => ({ format: 'stories', day })),
  ].sort(
    (a, b) => a.day - b.day || FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format),
  );
}

export function buildPlan(
  strategy: Strategy,
  start: Date,
  publishTime: string,
  weeks = PLAN_WEEKS,
): PlanItem[] {
  const cadence = normalizeCadence(strategy.cadence);
  const pillars: StrategyPillar[] =
    strategy.pillars.length > 0
      ? strategy.pillars
      : [{ title: GENERIC_PILLAR_TITLE, description: '', ideas: [] }];
  const ideaCounters = pillars.map(() => 0);
  const items: PlanItem[] = [];
  let pillarCursor = 0;

  for (let week = 0; week < weeks; week += 1) {
    const counters = new Map<string, number>();
    placeWeek(cadence).forEach((placement) => {
      const pillarIndex = pillarCursor % pillars.length;
      pillarCursor += 1;
      const pillar = pillars[pillarIndex];
      const idea =
        pillar.ideas.length > 0
          ? pillar.ideas[ideaCounters[pillarIndex] % pillar.ideas.length]
          : pillar.title;
      ideaCounters[pillarIndex] += 1;

      const date = toDateKey(addDays(start, week * 7 + placement.day));
      const key = `${date}-${placement.format}`;
      const order = counters.get(key) ?? 0;
      counters.set(key, order + 1);
      items.push({
        id: `${key}-${order}`,
        date,
        time: publishTime,
        format: placement.format,
        pillar: pillar.title,
        idea,
        done: false,
      });
    });
  }
  return items;
}
