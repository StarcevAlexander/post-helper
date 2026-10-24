import { Service, effect, inject, signal, untracked } from '@angular/core';
import {
  CALENDAR_STORAGE_KEY,
  KITS_STORAGE_KEY,
  MONTH_REVIEWS_STORAGE_KEY,
  RECOMMENDATIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
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
import { MonthReviews } from './month-reviews';
import { PAGE_RELOAD } from './page-reload';
import { Recommendations } from './recommendations';
import { Settings } from './settings';

const SYNC_KEYS: Record<SyncKey, string> = {
  strategy: STRATEGY_STORAGE_KEY,
  calendar: CALENDAR_STORAGE_KEY,
  kits: KITS_STORAGE_KEY,
  monthReviews: MONTH_REVIEWS_STORAGE_KEY,
  recommendations: RECOMMENDATIONS_STORAGE_KEY,
  settings: SETTINGS_STORAGE_KEY,
};

const KEYS = Object.keys(SYNC_KEYS) as SyncKey[];

@Service()
export class Sync {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly account = inject(Account);
  private readonly calendar = inject(CalendarPlan);
  private readonly kits = inject(Kits);
  private readonly monthReviews = inject(MonthReviews);
  private readonly recommendations = inject(Recommendations);
  private readonly settings = inject(Settings);
  private readonly reload = inject(PAGE_RELOAD);

  readonly status = signal<SyncStatus>('off');

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
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
      this.settings.theme();
      this.settings.scale();
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
    if (!this.account.signedIn() || this.running) {
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
    if (!this.account.signedIn() || !meta?.dirty || this.running) {
      return;
    }
    if (meta.version > 0 && JSON.stringify(this.readBundle()) === this.lastSyncedJson) {
      this.writeMeta({ version: meta.version, dirty: false });
      this.status.set('ok');
      return;
    }
    void this.push(meta.version);
  }

  async settle(): Promise<boolean> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const meta = this.readMeta();
    if (!this.account.signedIn() || !meta?.dirty) {
      return true;
    }
    await this.push(meta.version);
    return this.readMeta()?.dirty !== true;
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
    this.lastSyncedJson = JSON.stringify(remote);
    this.status.set('ok');
    if (!same) {
      this.reload();
    }
  }

  private markDirty(): void {
    if (!this.account.signedIn()) {
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
      const bundle = this.readBundle();
      const saved = await this.api.saveState(baseVersion, bundle);
      this.lastSyncedJson = JSON.stringify(bundle);
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
