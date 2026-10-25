import { Service, effect, inject, signal, untracked } from '@angular/core';
import { FORMAT_ORDER, KITS_STORAGE_KEY } from '../constants';
import { PlanItem, PostFormat, PublicationKit, StoredKit } from '../models';
import { CalendarPlan } from './calendar-plan';

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isKit(value: unknown): value is PublicationKit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isStringList(candidate['shots']) &&
    isStringList(candidate['hashtags']) &&
    typeof candidate['caption'] === 'string' &&
    typeof candidate['tip'] === 'string' &&
    Array.isArray(candidate['frames']) &&
    candidate['frames'].every((frame: unknown) => {
      if (typeof frame !== 'object' || frame === null) {
        return false;
      }
      const item = frame as Record<string, unknown>;
      return typeof item['visual'] === 'string' && typeof item['overlay'] === 'string';
    })
  );
}

function isStoredKit(value: unknown): value is StoredKit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['itemId'] === 'string' &&
    FORMAT_ORDER.includes(candidate['format'] as PostFormat) &&
    typeof candidate['pillar'] === 'string' &&
    typeof candidate['idea'] === 'string' &&
    isKit(candidate['kit'])
  );
}

@Service()
export class Kits {
  private readonly plan = inject(CalendarPlan);

  readonly stored = signal<Record<string, StoredKit>>(this.restore());

  constructor() {
    effect(() => {
      const ids = new Set(this.plan.items().map((item) => item.id));
      untracked(() => this.dropMissing(ids));
    });
  }

  kitFor(item: PlanItem): PublicationKit | undefined {
    const entry = this.stored()[item.id];
    return entry && this.matches(entry, item) ? entry.kit : undefined;
  }

  private matches(entry: StoredKit, item: PlanItem): boolean {
    return entry.format === item.format && entry.pillar === item.pillar && entry.idea === item.idea;
  }

  private dropMissing(ids: Set<string>): void {
    const entries = this.stored();
    if (Object.keys(entries).every((id) => ids.has(id))) {
      return;
    }
    this.stored.set(Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id))));
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KITS_STORAGE_KEY, JSON.stringify(this.stored()));
    } catch {
      return;
    }
  }

  private restore(): Record<string, StoredKit> {
    try {
      const raw = localStorage.getItem(KITS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, StoredKit] =>
            isStoredKit(entry[1]) && entry[1].itemId === entry[0],
        ),
      );
    } catch {
      return {};
    }
  }
}
