import { EVENT_LABELS, MAX_EVENT_SUMMARY_RUNES } from '../constants';
import { JsonValue, MasterEvent } from '../models';

type JsonRecord = { [key: string]: JsonValue };

function asRecord(value: JsonValue | undefined): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function clip(value: string): string {
  const letters = Array.from(value.replace(/\s+/g, ' ').trim());
  return letters.length > MAX_EVENT_SUMMARY_RUNES
    ? `${letters.slice(0, MAX_EVENT_SUMMARY_RUNES - 1).join('')}…`
    : letters.join('');
}

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}

export function summarizeEvent(event: MasterEvent): string {
  const payload = asRecord(event.payload);
  if (!payload) {
    return '';
  }
  switch (event.kind) {
    case 'chat':
      return clip(text(payload['text']));
    case 'kit': {
      const request = asRecord(payload['request']);
      return clip(`${text(request?.['format'])}: ${text(request?.['idea'])}`);
    }
    case 'review': {
      const items = asRecord(payload['request'])?.['items'];
      if (!Array.isArray(items)) {
        return '';
      }
      const done = items.filter((item) => asRecord(item)?.['done'] === true).length;
      return `Выполнено ${done} из ${items.length}`;
    }
    case 'audit': {
      const images = payload['images'];
      return Array.isArray(images) ? `Скриншотов: ${images.length}` : '';
    }
    case 'strategy': {
      const summary = asRecord(payload['strategy'])?.['summary'];
      return clip(text(summary));
    }
    case 'admin.restore':
      return `версия ${payload['fromVersion']} → ${payload['newVersion']}`;
    default:
      return '';
  }
}
