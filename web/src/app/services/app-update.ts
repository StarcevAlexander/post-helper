import { Service, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { UPDATE_APPLY_RETRY_MS, UPDATE_CHECK_INTERVAL_MS } from '../constants';
import { PAGE_RELOAD } from './page-reload';
import { Sync } from './sync';

@Service()
export class AppUpdate {
  readonly ready = signal(false);

  private readonly swUpdate = inject(SwUpdate);
  private readonly sync = inject(Sync);
  private readonly reload = inject(PAGE_RELOAD);
  private idleCheck: () => boolean = () => true;
  private started = false;
  private applying = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  setIdleCheck(check: () => boolean): void {
    this.idleCheck = check;
  }

  start(): void {
    if (this.started || !this.swUpdate.isEnabled) {
      return;
    }
    this.started = true;

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => {
        this.ready.set(true);
        this.tryApply();
      });
    this.swUpdate.unrecoverable.subscribe(() => this.reload());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.check();
        this.tryApply();
      }
    });
    window.addEventListener('online', () => void this.check());
    setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS);
    void this.check();
  }

  async apply(): Promise<void> {
    if (this.applying) {
      return;
    }
    this.applying = true;
    clearTimeout(this.retryTimer);
    this.sync.flush();
    try {
      await this.swUpdate.activateUpdate();
    } catch {
      this.applying = false;
      this.retryTimer = setTimeout(() => this.tryApply(), UPDATE_APPLY_RETRY_MS);
      return;
    }
    this.ready.set(false);
    this.reload();
  }

  private tryApply(): void {
    clearTimeout(this.retryTimer);
    if (!this.ready() || this.applying) {
      return;
    }
    if (this.idleCheck()) {
      void this.apply();
      return;
    }
    this.retryTimer = setTimeout(() => this.tryApply(), UPDATE_APPLY_RETRY_MS);
  }

  private async check(): Promise<void> {
    await this.swUpdate.checkForUpdate().catch(() => false);
  }
}
