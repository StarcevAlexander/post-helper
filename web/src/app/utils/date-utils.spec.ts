import {
  addDays,
  daysBetween,
  fromDateKey,
  mondayFirstWeekday,
  nextWeekday,
  toDateKey,
  withTime,
} from './date-utils';

describe('date utils', () => {
  it('round-trips local date keys', () => {
    const date = new Date(2026, 0, 5);

    expect(toDateKey(date)).toBe('2026-01-05');
    expect(fromDateKey('2026-01-05').getTime()).toBe(date.getTime());
  });

  it('adds days across month and year ends', () => {
    expect(toDateKey(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02');
    expect(toDateKey(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween(new Date(2026, 9, 20), new Date(2026, 9, 27))).toBe(7);
    expect(daysBetween(new Date(2026, 9, 27), new Date(2026, 9, 20))).toBe(-7);
  });

  it('numbers weekdays from Monday', () => {
    expect(mondayFirstWeekday(new Date(2026, 9, 19))).toBe(0);
    expect(mondayFirstWeekday(new Date(2026, 9, 25))).toBe(6);
  });

  it('finds the next matching weekday, today included', () => {
    expect(toDateKey(nextWeekday(new Date(2026, 9, 19), 3))).toBe('2026-10-22');
    expect(toDateKey(nextWeekday(new Date(2026, 9, 22), 3))).toBe('2026-10-22');
    expect(toDateKey(nextWeekday(new Date(2026, 9, 23), 3))).toBe('2026-10-29');
  });

  it('applies a time of day', () => {
    const date = withTime(new Date(2026, 9, 22), '18:05');

    expect(date.getHours()).toBe(18);
    expect(date.getMinutes()).toBe(5);
  });
});
