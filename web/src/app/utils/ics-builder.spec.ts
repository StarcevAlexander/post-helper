import { IcsEvent } from '../models';
import { buildIcs } from './ics-builder';

const NOW = new Date(Date.UTC(2026, 9, 19, 9, 30, 15));

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: 'content-day-3@pomoshchnik',
    summary: 'День контента, четверг',
    description: 'Снять материал',
    start: new Date(2026, 9, 22, 18, 0),
    durationMinutes: 120,
    alarmMinutes: 60,
    ...overrides,
  };
}

function unfold(text: string): string {
  return text.replace(/\r\n /g, '');
}

describe('buildIcs', () => {
  it('wraps events into a calendar with CRLF line ends', () => {
    const text = buildIcs([event()], NOW);

    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('writes local floating start and end times and a UTC stamp', () => {
    const text = buildIcs([event()], NOW);

    expect(text).toContain('DTSTART:20261022T180000');
    expect(text).toContain('DTEND:20261022T200000');
    expect(text).toContain('DTSTAMP:20261019T093015Z');
    expect(text).not.toContain('DTSTART:20261022T180000Z');
  });

  it('adds a display alarm before the event', () => {
    const text = buildIcs([event({ alarmMinutes: 15 })], NOW);

    expect(text).toContain('BEGIN:VALARM\r\nACTION:DISPLAY');
    expect(text).toContain('TRIGGER:-PT15M');
  });

  it('repeats weekly events on the chosen weekday only', () => {
    const weekly = buildIcs([event({ weeklyOn: 3 })], NOW);
    const single = buildIcs([event()], NOW);

    expect(weekly).toContain('RRULE:FREQ=WEEKLY;BYDAY=TH');
    expect(single).not.toContain('RRULE');
  });

  it('escapes commas, semicolons and line breaks', () => {
    const text = buildIcs(
      [event({ summary: 'Раз, два; три', description: 'Строка 1\nСтрока 2' })],
      NOW,
    );

    expect(text).toContain('SUMMARY:Раз\\, два\\; три');
    expect(text).toContain('DESCRIPTION:Строка 1\\nСтрока 2');
  });

  it('folds long lines to 75 octets and loses nothing when unfolded', () => {
    const summary = 'Очень длинное название события про маникюр и педикюр '.repeat(4).trim();
    const text = buildIcs([event({ summary })], NOW);
    const encoder = new TextEncoder();

    text
      .split('\r\n')
      .forEach((line) => expect(encoder.encode(line).length).toBeLessThanOrEqual(75));
    expect(unfold(text)).toContain(`SUMMARY:${summary}`);
    expect(text).toContain('\r\n ');
  });

  it('writes the link of the event only when there is one', () => {
    const link = 'https://example.github.io/post_helper/?screen=today';

    expect(buildIcs([event({ url: link })], NOW)).toContain(`URL:${link}\r\n`);
    expect(buildIcs([event()], NOW)).not.toContain('URL:');
  });

  it('keeps several events in one calendar', () => {
    const text = buildIcs([event(), event({ uid: 'other@pomoshchnik' })], NOW);

    expect(text.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(text.match(/END:VEVENT/g)?.length).toBe(2);
  });
});
