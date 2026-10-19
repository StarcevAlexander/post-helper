import { ICS_LINE_LIMIT_OCTETS, ICS_PRODUCT_ID, ICS_WEEKDAY_CODES } from '../constants';
import { IcsEvent } from '../models';

const LINE_BREAK = '\r\n';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocal(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function formatUtc(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const symbol of line) {
    const size = encoder.encode(symbol).length;
    const limit = parts.length === 0 ? ICS_LINE_LIMIT_OCTETS : ICS_LINE_LIMIT_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = symbol;
      octets = size;
    } else {
      current += symbol;
      octets += size;
    }
  }
  parts.push(current);
  return parts.join(`${LINE_BREAK} `);
}

function eventLines(event: IcsEvent, stamp: string): string[] {
  const end = new Date(event.start.getTime() + event.durationMinutes * 60_000);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatLocal(event.start)}`,
    `DTEND:${formatLocal(end)}`,
  ];
  if (event.weeklyOn !== undefined) {
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_WEEKDAY_CODES[event.weeklyOn]}`);
  }
  lines.push(
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.summary)}`,
    `TRIGGER:-PT${event.alarmMinutes}M`,
    'END:VALARM',
    'END:VEVENT',
  );
  return lines;
}

export function buildIcs(events: IcsEvent[], now = new Date()): string {
  const stamp = formatUtc(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((event) => eventLines(event, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(LINE_BREAK) + LINE_BREAK;
}
