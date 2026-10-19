import { Service, effect, inject, signal, untracked } from '@angular/core';
import {
  CALENDAR_STORAGE_KEY,
  CHAT_HISTORY_STORAGE_KEY,
  KITS_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  REVIEWS_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
  SYNC_BACKUP_STORAGE_KEY,
  SYNC_META_STORAGE_KEY,
  SYNC_PUSH_DELAY_MS,
} from '../constants';
import {
  ChatApiError,
  JsonValue,
  ServerState,
  StateConflictError,
  SyncBundle,
  SyncKey,
  SyncMeta,
  SyncStatus,
} from '../models';
import { Access } from './access';
import { Account } from './account';
import { CalendarPlan } from './calendar-plan';
import { ChatApi } from './chat-api';
import { Kits } from './kits';
import { Onboarding } from './onboarding';
import { PAGE_RELOAD } from './page-reload';
import { Reviews } from './reviews';

const SYNC_KEYS: Record<SyncKey, string> = {
  onboarding: ONBOARDING_STORAGE_KEY,
  strategy: STRATEGY_STORAGE_KEY,
  calendar: CALENDAR_STORAGE_KEY,
  kits: KITS_STORAGE_KEY,
  reviews: REVIEWS_STORAGE_KEY,
};

const KEYS = Object.keys(SYNC_KEYS) as SyncKey[];

@Service()
export class Sync {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly account = inject(Account);
  private readonly onboarding = inject(Onboarding);
  private readonly calendar = inject(CalendarPlan);
  private readonly kits = inject(Kits);
  private readonly reviews = inject(Reviews);
  private readonly reload = inject(PAGE_RELOAD);

  readonly status = signal<SyncStatus>('off');

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private revision = 0;
  private started = false;

  constructor() {
    effect(() => {
      if (this.account.role() === 'master') {
        untracked(() => void this.pull());
      } else {
        untracked(() => this.status.set('off'));
      }
    });

    effect(() => {
      this.onboarding.answers();
      this.onboarding.index();
      this.onboarding.confirmed();
      this.onboarding.resumeIndex();
      this.onboarding.strategy();
      this.calendar.items();
      this.calendar.schedule();
      this.kits.stored();
      this.reviews.items();
      if (!this.started) {
        this.started = true;
        return;
      }
      untracked(() => this.markDirty());
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void this.pull();
        } else {
          this.flush();
        }
      });
    }
  }

  async pull(): Promise<void> {
    if (this.account.role() !== 'master' || this.running) {
      return;
    }
    this.running = true;
    this.status.set('syncing');
    try {
      await this.reconcile(await this.api.loadState());
    } catch (error) {
      this.fail(error);
    } finally {
      this.running = false;
    }
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const meta = this.readMeta();
    if (this.account.role() === 'master' && meta?.dirty && !this.running) {
      void this.push(meta.version);
    }
  }

  private async reconcile(server: ServerState): Promise<void> {
    const meta = this.readMeta();
    const local = this.readBundle();
    const localEmpty = Object.keys(local).length === 0;

    if (server.version === 0 || !server.data) {
      if (localEmpty) {
        this.status.set('ok');
        return;
      }
      await this.push(0);
      return;
    }
    if (meta?.version === server.version) {
      if (meta.dirty) {
        await this.push(meta.version);
      } else {
        this.status.set('ok');
      }
      return;
    }
    if (meta?.dirty && !localEmpty) {
      await this.push(server.version);
      return;
    }
    this.applyRemote(server, local, localEmpty);
  }

  private applyRemote(server: ServerState, local: SyncBundle, localEmpty: boolean): void {
    const remote = server.data ?? {};
    const same = JSON.stringify(remote) === JSON.stringify(local);
    if (!same && !localEmpty) {
      this.writeRaw(SYNC_BACKUP_STORAGE_KEY, JSON.stringify(local));
    }
    if (!same) {
      this.removeRaw(CHAT_HISTORY_STORAGE_KEY);
      KEYS.forEach((key) => {
        const value = remote[key];
        if (value === undefined) {
          this.removeRaw(SYNC_KEYS[key]);
        } else {
          this.writeRaw(SYNC_KEYS[key], JSON.stringify(value));
        }
      });
    }
    this.writeMeta({ version: server.version, dirty: false });
    this.status.set('ok');
    if (!same) {
      this.reload();
    }
  }

  private markDirty(): void {
    if (this.account.role() !== 'master') {
      return;
    }
    this.revision += 1;
    const meta = this.readMeta();
    this.writeMeta({ version: meta?.version ?? 0, dirty: true });
    this.status.set('idle');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SYNC_PUSH_DELAY_MS);
  }

  private async push(baseVersion: number, retry = true): Promise<void> {
    this.status.set('syncing');
    const startedAt = this.revision;
    try {
      const saved = await this.api.saveState(baseVersion, this.readBundle());
      const changedMeanwhile = this.revision !== startedAt;
      this.writeMeta({ version: saved.version, dirty: changedMeanwhile });
      this.status.set(changedMeanwhile ? 'idle' : 'ok');
      if (changedMeanwhile) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), SYNC_PUSH_DELAY_MS);
      }
    } catch (error) {
      if (error instanceof StateConflictError && retry) {
        await this.push(error.state.version, false);
        return;
      }
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof ChatApiError && error.unauthorized) {
      this.access.clear();
      this.status.set('off');
      return;
    }
    this.status.set('error');
  }

  private readBundle(): SyncBundle {
    const bundle: SyncBundle = {};
    KEYS.forEach((key) => {
      try {
        const raw = localStorage.getItem(SYNC_KEYS[key]);
        if (raw) {
          bundle[key] = JSON.parse(raw) as JsonValue;
        }
      } catch {
        return;
      }
    });
    return bundle;
  }

  private readMeta(): SyncMeta | undefined {
    try {
      const raw = localStorage.getItem(SYNC_META_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (typeof parsed === 'object' && parsed !== null) {
        const candidate = parsed as Record<string, unknown>;
        if (typeof candidate['version'] === 'number' && typeof candidate['dirty'] === 'boolean') {
          return { version: candidate['version'], dirty: candidate['dirty'] };
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private writeMeta(meta: SyncMeta): void {
    this.writeRaw(SYNC_META_STORAGE_KEY, JSON.stringify(meta));
  }

  private writeRaw(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      return;
    }
  }

  private removeRaw(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      return;
    }
  }
}
