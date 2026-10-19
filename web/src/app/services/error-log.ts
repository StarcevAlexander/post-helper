import { Service, effect, signal } from '@angular/core';
import {
  ERROR_LOG_STORAGE_KEY,
  ERROR_SOURCE_LABELS,
  MAX_ERROR_ENTRIES,
  MAX_ERROR_MESSAGE_LENGTH,
} from '../constants';
import { ErrorEntry, ErrorSource, StoredErrorEntry } from '../models';

function isStoredEntry(value: unknown): value is StoredErrorEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['message'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    !Number.isNaN(Date.parse(candidate['createdAt'])) &&
    typeof candidate['source'] === 'string' &&
    candidate['source'] in ERROR_SOURCE_LABELS
  );
}

@Service()
export class ErrorLog {
  readonly entries = signal<ErrorEntry[]>(this.restore());

  constructor() {
    effect(() => this.save(this.entries()));
  }

  record(source: ErrorSource, message: string): void {
    const entry: ErrorEntry = {
      id: crypto.randomUUID(),
      source,
      message: Array.from(message.trim()).slice(0, MAX_ERROR_MESSAGE_LENGTH).join(''),
      createdAt: new Date(),
    };
    this.entries.update((entries) => [...entries, entry].slice(-MAX_ERROR_ENTRIES));
  }

  clear(): void {
    this.entries.set([]);
  }

  private restore(): ErrorEntry[] {
    try {
      const raw = localStorage.getItem(ERROR_LOG_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(isStoredEntry)
        .map((stored) => ({ ...stored, createdAt: new Date(stored.createdAt) }))
        .slice(-MAX_ERROR_ENTRIES);
    } catch {
      return [];
    }
  }

  private save(entries: ErrorEntry[]): void {
    const stored: StoredErrorEntry[] = entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    }));
    try {
      localStorage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      return;
    }
  }
}
