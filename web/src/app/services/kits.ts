import { Service, effect, inject, signal, untracked } from '@angular/core';
import { KITS_STORAGE_KEY, KIT_NO_DATA_TEXT } from '../constants';
import {
  ChatApiError,
  KitBatch,
  KitStatus,
  PlanItem,
  PostFormat,
  PublicationKit,
  StoredKit,
} from '../models';
import { Access } from './access';
import { CalendarPlan } from './calendar-plan';
import { ChatApi } from './chat-api';
import { ErrorLog } from './error-log';
import { Onboarding } from './onboarding';

const FORMATS: readonly PostFormat[] = ['reels', 'post', 'stories'];

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
    FORMATS.includes(candidate['format'] as PostFormat) &&
    typeof candidate['pillar'] === 'string' &&
    typeof candidate['idea'] === 'string' &&
    isKit(candidate['kit'])
  );
}

@Service()
export class Kits {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly onboarding = inject(Onboarding);
  private readonly plan = inject(CalendarPlan);
  private readonly errorLog = inject(ErrorLog);

  readonly stored = signal<Record<string, StoredKit>>(this.restore());
  readonly progress = signal<Record<string, KitStatus>>({});
  readonly errors = signal<Record<string, string>>({});
  readonly batch = signal<KitBatch | undefined>(undefined);
  readonly viewing = signal<string | undefined>(undefined);

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

  statusOf(item: PlanItem): KitStatus {
    const progress = this.progress()[item.id];
    if (progress === 'loading') {
      return 'loading';
    }
    return this.kitFor(item) ? 'ready' : (progress ?? 'idle');
  }

  errorOf(item: PlanItem): string | undefined {
    return this.errors()[item.id];
  }

  view(id: string): void {
    this.viewing.set(id);
  }

  closeView(): void {
    this.viewing.set(undefined);
  }

  async generate(item: PlanItem): Promise<boolean> {
    if (this.progress()[item.id] === 'loading') {
      return false;
    }
    const profile = this.onboarding.profile();
    const strategy = this.onboarding.strategy();
    if (!profile || !strategy) {
      this.fail(item, KIT_NO_DATA_TEXT);
      return false;
    }

    this.setStatus(item.id, 'loading');
    try {
      const kit = await this.api.requestKit({
        profile,
        positioning: strategy.positioning,
        format: item.format,
        pillar: item.pillar,
        idea: item.idea,
      });
      this.stored.update((entries) => ({
        ...entries,
        [item.id]: {
          itemId: item.id,
          format: item.format,
          pillar: item.pillar,
          idea: item.idea,
          kit,
        },
      }));
      this.save();
      this.setStatus(item.id, 'idle');
      this.clearError(item.id);
      return true;
    } catch (error) {
      if (error instanceof ChatApiError && error.unauthorized) {
        this.access.clear();
      }
      const message = error instanceof ChatApiError ? error.message : String(error);
      this.errorLog.record('send', message);
      this.fail(item, message);
      return false;
    }
  }

  async generateMany(items: PlanItem[]): Promise<void> {
    if (this.batch()) {
      return;
    }
    const pending = items.filter((item) => !this.kitFor(item));
    if (pending.length === 0) {
      return;
    }
    this.batch.set({ done: 0, total: pending.length });
    for (const item of pending) {
      await this.generate(item);
      if (!this.access.granted()) {
        break;
      }
      this.batch.update((batch) => (batch ? { ...batch, done: batch.done + 1 } : batch));
    }
    this.batch.set(undefined);
  }

  private matches(entry: StoredKit, item: PlanItem): boolean {
    return entry.format === item.format && entry.pillar === item.pillar && entry.idea === item.idea;
  }

  private setStatus(id: string, status: KitStatus): void {
    this.progress.update((progress) => ({ ...progress, [id]: status }));
  }

  private fail(item: PlanItem, message: string): void {
    this.setStatus(item.id, 'failed');
    this.errors.update((errors) => ({ ...errors, [item.id]: message }));
  }

  private clearError(id: string): void {
    this.errors.update((errors) => {
      const rest = { ...errors };
      delete rest[id];
      return rest;
    });
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
