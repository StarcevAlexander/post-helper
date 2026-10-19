import { Strategy } from '../models';
import { daysBetween, fromDateKey } from './date-utils';
import { buildPlan } from './plan-builder';

const START = new Date(2026, 9, 20);

function strategyWith(cadence: Partial<Strategy['cadence']>, pillars = 3): Strategy {
  return {
    summary: 'Ок',
    positioning: '',
    profileFixes: [],
    pillars: Array.from({ length: pillars }, (_, index) => ({
      title: `Рубрика ${index + 1}`,
      description: '',
      ideas: [`Идея ${index + 1}.1`, `Идея ${index + 1}.2`],
    })),
    cadence: { reels: 2, posts: 2, stories: 5, note: '', ...cadence },
    firstSteps: [],
  };
}

describe('buildPlan', () => {
  it('places the weekly cadence in every week', () => {
    const items = buildPlan(strategyWith({}), START, '19:00');

    expect(items.length).toBe(36);
    for (let week = 0; week < 4; week += 1) {
      const inWeek = items.filter((item) => {
        const offset = daysBetween(START, fromDateKey(item.date));
        return offset >= week * 7 && offset < week * 7 + 7;
      });
      expect(inWeek.filter((item) => item.format === 'reels').length).toBe(2);
      expect(inWeek.filter((item) => item.format === 'post').length).toBe(2);
      expect(inWeek.filter((item) => item.format === 'stories').length).toBe(5);
    }
  });

  it('keeps every publication inside the four weeks and sorted by date', () => {
    const items = buildPlan(strategyWith({}), START, '19:00');

    const offsets = items.map((item) => daysBetween(START, fromDateKey(item.date)));
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(27);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it('puts reels and posts on different days and alternates them', () => {
    const firstWeek = buildPlan(strategyWith({}), START, '19:00')
      .filter((item) => item.format !== 'stories')
      .slice(0, 4);

    expect(firstWeek.map((item) => item.format)).toEqual(['reels', 'post', 'reels', 'post']);
    expect(new Set(firstWeek.map((item) => item.date)).size).toBe(4);
  });

  it('gives every item a unique id and the agreed time', () => {
    const items = buildPlan(strategyWith({ stories: 14 }), START, '18:30');

    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.every((item) => item.time === '18:30' && !item.done)).toBe(true);
  });

  it('rotates through the pillars and their ideas', () => {
    const items = buildPlan(strategyWith({}), START, '19:00');

    expect(new Set(items.slice(0, 3).map((item) => item.pillar)).size).toBe(3);
    const ideas = items.filter((item) => item.pillar === 'Рубрика 1').map((item) => item.idea);
    expect(ideas.slice(0, 4)).toEqual(['Идея 1.1', 'Идея 1.2', 'Идея 1.1', 'Идея 1.2']);
  });

  it('uses the default cadence when the strategy has none', () => {
    const items = buildPlan(strategyWith({ reels: 0, posts: 0, stories: 0 }), START, '19:00');

    expect(items.length).toBe(20);
    expect(items.filter((item) => item.format === 'reels').length).toBe(4);
    expect(items.filter((item) => item.format === 'stories').length).toBe(12);
  });

  it('clamps nonsense counts instead of flooding the calendar', () => {
    const items = buildPlan(
      strategyWith({ reels: 500, posts: -4, stories: Number.NaN }),
      START,
      '19:00',
      1,
    );

    expect(items.length).toBe(14);
    expect(items.every((item) => item.format === 'reels')).toBe(true);
  });

  it('falls back to a generic topic when there are no pillars or ideas', () => {
    const empty = buildPlan(strategyWith({}, 0), START, '19:00', 1);
    const noIdeas: Strategy = {
      ...strategyWith({}),
      pillars: [{ title: 'Окошки', description: '', ideas: [] }],
    };

    expect(empty.every((item) => item.pillar.length > 0 && item.idea.length > 0)).toBe(true);
    expect(buildPlan(noIdeas, START, '19:00', 1).every((item) => item.idea === 'Окошки')).toBe(
      true,
    );
  });
});
