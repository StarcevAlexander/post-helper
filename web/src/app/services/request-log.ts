import { Service, effect, signal } from '@angular/core';
import {
  MAX_REQUEST_ENTRIES,
  MAX_REQUEST_TEXT_LENGTH,
  REQUEST_LOG_INTERRUPTED_TEXT,
  REQUEST_LOG_STORAGE_KEY,
  REQUEST_STATUS_LABELS,
} from '../constants';
import { RequestDescriptor, RequestEntry, RequestStatus, StoredRequestEntry } from '../models';

function isStoredEntry(value: unknown): value is StoredRequestEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['description'] === 'string' &&
    typeof candidate['sent'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    !Number.isNaN(Date.parse(candidate['createdAt'])) &&
    typeof candidate['status'] === 'string' &&
    candidate['status'] in REQUEST_STATUS_LABELS &&
    (candidate['durationMs'] === undefined || typeof candidate['durationMs'] === 'number') &&
    (candidate['received'] === undefined || typeof candidate['received'] === 'string')
  );
}

function shorten(text: string): string {
  const letters = Array.from(text.trim());
  return letters.length > MAX_REQUEST_TEXT_LENGTH
    ? `${letters.slice(0, MAX_REQUEST_TEXT_LENGTH).join('')}…`
    : letters.join('');
}

@Service()
export class RequestLog {
  readonly entries = signal<RequestEntry[]>(this.restore());

  constructor() {
    effect(() => this.save(this.entries()));
  }

  start(descriptor: RequestDescriptor): string {
    const entry: RequestEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      description: descriptor.description,
      status: 'pending',
      sent: shorten(descriptor.sent),
    };
    this.entries.update((entries) => [...entries, entry].slice(-MAX_REQUEST_ENTRIES));
    return entry.id;
  }

  finish(id: string, status: Exclude<RequestStatus, 'pending'>, received: string): void {
    const now = Date.now();
    this.entries.update((entries) =>
      entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status,
              durationMs: Math.max(now - entry.createdAt.getTime(), 0),
              received: shorten(received),
            }
          : entry,
      ),
    );
  }

  clear(): void {
    this.entries.set([]);
  }

  private restore(): RequestEntry[] {
    try {
      const raw = localStorage.getItem(REQUEST_LOG_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(isStoredEntry)
        .map((stored): RequestEntry => {
          const entry = { ...stored, createdAt: new Date(stored.createdAt) };
          return entry.status === 'pending'
            ? { ...entry, status: 'error', received: REQUEST_LOG_INTERRUPTED_TEXT }
            : entry;
        })
        .slice(-MAX_REQUEST_ENTRIES);
    } catch {
      return [];
    }
  }

  private save(entries: RequestEntry[]): void {
    const stored: StoredRequestEntry[] = entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    }));
    try {
      localStorage.setItem(REQUEST_LOG_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      return;
    }
  }
}
