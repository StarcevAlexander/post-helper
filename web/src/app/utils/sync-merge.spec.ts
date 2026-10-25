import { SyncBundle } from '../models';
import { mergeBundles } from './sync-merge';

const remoteCalendar = {
  startedOn: '2026-10-20',
  schedule: { slots: [{ weekday: 3, time: '18:00' }], publishTime: '19:00' },
  items: [
    {
      id: 'a',
      date: '2026-10-21',
      time: '19:00',
      format: 'post',
      pillar: 'p',
      idea: 'new a',
      done: false,
    },
    {
      id: 'c',
      date: '2026-10-23',
      time: '19:00',
      format: 'reels',
      pillar: 'p',
      idea: 'c',
      done: false,
    },
  ],
};

const localCalendar = {
  startedOn: '2026-10-13',
  schedule: { slots: [{ weekday: 1, time: '10:00' }], publishTime: '12:00' },
  items: [
    {
      id: 'a',
      date: '2026-10-14',
      time: '12:00',
      format: 'post',
      pillar: 'p',
      idea: 'old a',
      done: true,
    },
    {
      id: 'b',
      date: '2026-10-15',
      time: '12:00',
      format: 'post',
      pillar: 'p',
      idea: 'b',
      done: true,
    },
  ],
};

describe('mergeBundles', () => {
  it('takes the owner data from the server and keeps the done marks of the phone', () => {
    const merged = mergeBundles(
      { calendar: remoteCalendar, kits: { a: { caption: 'new' } } },
      { calendar: localCalendar, kits: { a: { caption: 'old' } } },
    );

    expect(merged.kits).toEqual({ a: { caption: 'new' } });
    expect(merged.calendar).toEqual({
      ...remoteCalendar,
      items: [{ ...remoteCalendar.items[0], done: true }, remoteCalendar.items[1]],
    });
  });

  it('keeps the settings and the shooting marks of the phone', () => {
    const local: SyncBundle = {
      settings: { theme: 'ocean', scale: 110 },
      shootProgress: ['a:1'],
    };

    const merged = mergeBundles(
      { settings: { theme: 'dark', scale: 100 }, shootProgress: [] },
      local,
    );

    expect(merged.settings).toEqual({ theme: 'ocean', scale: 110 });
    expect(merged.shootProgress).toEqual(['a:1']);
  });

  it('keeps the done marks of recommendations by id', () => {
    const merged = mergeBundles(
      {
        recommendations: [
          { id: 'r1', text: 'new', importance: 90, done: false },
          { id: 'r3', text: 'added', importance: 10, done: false },
        ],
      },
      {
        recommendations: [
          { id: 'r1', text: 'old', importance: 90, done: true },
          { id: 'r2', text: 'gone', importance: 50, done: true },
        ],
      },
    );

    expect(merged.recommendations).toEqual([
      { id: 'r1', text: 'new', importance: 90, done: true },
      { id: 'r3', text: 'added', importance: 10, done: false },
    ]);
  });

  it('falls back to whichever side has the data', () => {
    const merged = mergeBundles({ monthReviews: [{ id: 'm1' }] }, { calendar: localCalendar });

    expect(merged.monthReviews).toEqual([{ id: 'm1' }]);
    expect(merged.calendar).toEqual(localCalendar);
  });

  it('prefers the server when the shapes are unexpected', () => {
    const merged = mergeBundles({ calendar: 'odd' }, { calendar: localCalendar });

    expect(merged.calendar).toBe('odd');
  });
});
