import { Service, effect, inject, signal, untracked } from '@angular/core';
import {
  CALENDAR_STORAGE_KEY,
  KITS_STORAGE_KEY,
  MONTH_REVIEWS_STORAGE_KEY,
  RECOMMENDATIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SHOOT_PROGRESS_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
  SYNC_BACKUP_STORAGE_KEY,
  SYNC_META_STORAGE_KEY,
  SYNC_PUSH_DELAY_MS,
  SYNC_RETRY_DELAY_MS,
} from '../constants';
import {
  ApiError,
  JsonValue,
  ServerState,
  StateConflictError,
  SyncBundle,
  SyncKey,
  SyncMeta,
  SyncStatus,
} from '../models';
import { mergeBundles } from '../utils/sync-merge';
import { Access } from './access';
import { Account } from './account';
import { ApiClient } from './api-client';
import { CalendarPlan } from './calendar-plan';
import { Kits } from './kits';
import { MonthReviews } from './month-reviews';
import { PAGE_RELOAD } from './page-reload';
import { Recommendations } from './recommendations';
import { Settings } from './settings';
import { ShootProgress } from './shoot-progress';

const SYNC_KEYS: Record<SyncKey, string> = {
  strategy: STRATEGY_STORAGE_KEY,
  calendar: CALENDAR_STORAGE_KEY,
  kits: KITS_STORAGE_KEY,
  monthReviews: MONTH_REVIEWS_STORAGE_KEY,
  recommendations: RECOMMENDATIONS_STORAGE_KEY,
  shootProgress: SHOOT_PROGRESS_STORAGE_KEY,
  settings: SETTINGS_STORAGE_KEY,
};

const KEYS = Object.keys(SYNC_KEYS) as SyncKey[];

@Service()
export class Sync {
  private readonly api = inject(ApiClient);
  private readonly access = inject(Access);
  private readonly account = inject(Account);
  private readonly calendar = inject(CalendarPlan);
  private readonly kits = inject(Kits);
  private readonly monthReviews = inject(MonthReviews);
  private readonly recommendations = inject(Recommendations);
  private readonly settings = inject(Settings);
  private readonly shootProgress = inject(ShootProgress);
  private readonly reload = inject(PAGE_RELOAD);

  readonly status = signal<SyncStatus>('off');

  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<void> | undefined;
  private revision = 0;
  private lastSyncedJson: string | undefined;
  private started = false;

  constructor() {
    effect(() => {
      if (this.account.signedIn()) {
        untracked(() => void this.pull());
      } else {
        untracked(() => this.status.set('off'));
      }
    });

    effect(() => {
      this.calendar.items();
      this.calendar.schedule();
      this.kits.stored();
      this.monthReviews.items();
      this.recommendations.items();
      this.shootProgress.marks();
      this.settings.theme();
      this.settings.scale();
      this.settings.tutorialSeen();
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
      window.addEventListener('online', () => void this.pull());
    }
  }

  pull(): Promise<void> {
    if (!this.account.signedIn()) {
      return Promise.resolve();
    }
    return this.run(async () => {
      this.status.set('syncing');
      try {
        await this.reconcile(await this.api.loadState());
      } catch (error) {
        this.fail(error);
      }
    });
  }

  flush(): void {
    this.clearTimers();
    const meta = this.readMeta();
    if (!this.account.signedIn() || !meta?.dirty) {
      return;
    }
    if (meta.version > 0 && JSON.stringify(this.readBundle()) === this.lastSyncedJson) {
      this.writeMeta({ version: meta.version, dirty: false });
      this.status.set('ok');
      return;
    }
    void this.run(() => this.push(meta.version));
  }

  async settle(): Promise<boolean> {
    this.clearTimers();
    if (this.inflight) {
      await this.inflight;
    }
    const meta = this.readMeta();
    if (!this.account.signedIn() || !meta?.dirty) {
      return true;
    }
    await this.run(() => this.push(meta.version));
    return this.readMeta()?.dirty !== true;
  }

  private run(work: () => Promise<void>): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    const task = work().finally(() => {
      this.inflight = undefined;
    });
    this.inflight = task;
    return task;
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
        this.lastSyncedJson = JSON.stringify(local);
        this.status.set('ok');
      }
      return;
    }
    if (meta?.dirty && !localEmpty) {
      await this.mergeAndPush(server, local);
      return;
    }
    this.applyRemote(server, local, localEmpty);
  }

  private async mergeAndPush(server: ServerState, local: SyncBundle): Promise<void> {
    const merged = mergeBundles(server.data ?? {}, local);
    const changed = JSON.stringify(merged) !== JSON.stringify(local);
    if (changed) {
      this.writeRaw(SYNC_BACKUP_STORAGE_KEY, JSON.stringify(local));
      this.writeBundle(merged);
    }
    this.writeMeta({ version: server.version, dirty: true });
    await this.push(server.version, false);
    if (changed) {
      this.reload();
    }
  }

  private applyRemote(server: ServerState, local: SyncBundle, localEmpty: boolean): void {
    const remote = server.data ?? {};
    const same = JSON.stringify(remote) === JSON.stringify(local);
    if (!same && !localEmpty) {
      this.writeRaw(SYNC_BACKUP_STORAGE_KEY, JSON.stringify(local));
    }
    if (!same) {
      this.writeBundle(remote);
    }
    this.writeMeta({ version: server.version, dirty: false });
    this.lastSyncedJson = JSON.stringify(remote);
    this.status.set('ok');
    if (!same) {
      this.reload();
    }
  }

  private markDirty(): void {
    if (!this.access.granted()) {
      return;
    }
    this.revision += 1;
    const meta = this.readMeta();
    this.writeMeta({ version: meta?.version ?? 0, dirty: true });
    this.status.set('idle');
    this.scheduleFlush(SYNC_PUSH_DELAY_MS);
  }

  private async push(baseVersion: number, retry = true): Promise<void> {
    this.status.set('syncing');
    const startedAt = this.revision;
    try {
      const bundle = this.readBundle();
      const saved = await this.api.saveState(baseVersion, bundle);
      this.lastSyncedJson = JSON.stringify(bundle);
      const changedMeanwhile = this.revision !== startedAt;
      this.writeMeta({ version: saved.version, dirty: changedMeanwhile });
      this.status.set(changedMeanwhile ? 'idle' : 'ok');
      if (changedMeanwhile) {
        this.scheduleFlush(SYNC_PUSH_DELAY_MS);
      }
    } catch (error) {
      if (error instanceof StateConflictError && retry) {
        await this.mergeAndPush(error.state, this.readBundle());
        return;
      }
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof ApiError && error.unauthorized) {
      this.access.clear();
      this.status.set('off');
      return;
    }
    this.status.set('error');
    if (this.readMeta()?.dirty) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.flush(), SYNC_RETRY_DELAY_MS);
    }
  }

  private scheduleFlush(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  private clearTimers(): void {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = undefined;
    this.retryTimer = undefined;
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

  private writeBundle(bundle: SyncBundle): void {
    KEYS.forEach((key) => {
      const value = bundle[key];
      if (value === undefined) {
        this.removeRaw(SYNC_KEYS[key]);
      } else {
        this.writeRaw(SYNC_KEYS[key], JSON.stringify(value));
      }
    });
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
