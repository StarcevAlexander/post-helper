import { Service, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import {
  UPDATE_APPLY_RETRY_MS,
  UPDATE_ATTEMPTS_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_LAUNCH_POLL_MS,
  UPDATE_LAUNCH_WAIT_MS,
  UPDATE_MAX_ATTEMPTS,
  UPDATE_VERSION_PATH,
} from '../constants';
import { isNewerVersion } from '../utils/version';
import { APP_VERSION } from '../version';
import { PAGE_RELOAD } from './page-reload';
import { Sync } from './sync';

@Service()
export class AppUpdate {
  readonly ready = signal(false);
  readonly updating = signal(false);

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
    if (this.started) {
      return;
    }
    this.started = true;

    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
        .subscribe(() => {
          this.ready.set(true);
          this.tryApply();
        });
      this.swUpdate.unrecoverable.subscribe(() => this.reload());
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.check();
        this.tryApply();
      }
    });
    window.addEventListener('online', () => void this.check());
    setInterval(() => void this.check(), UPDATE_CHECK_INTERVAL_MS);
    void this.check(true);
  }

  async apply(): Promise<void> {
    if (this.applying) {
      return;
    }
    this.applying = true;
    clearTimeout(this.retryTimer);
    this.sync.flush();
    if (!this.swUpdate.isEnabled) {
      this.ready.set(false);
      this.reload();
      return;
    }
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

  private async check(atLaunch = false): Promise<void> {
    const published = await this.publishedVersion();
    const newer = published !== undefined && isNewerVersion(published, APP_VERSION);
    if (!newer) {
      this.forgetAttempts();
    }
    if (newer && atLaunch && this.takeAttempt(published)) {
      this.updating.set(true);
    }
    if (this.swUpdate.isEnabled) {
      await this.swUpdate.checkForUpdate().catch(() => false);
    } else if (newer) {
      this.ready.set(true);
    }
    if (this.updating()) {
      await this.finishLaunchUpdate();
    }
  }

  private async finishLaunchUpdate(): Promise<void> {
    const deadline = Date.now() + UPDATE_LAUNCH_WAIT_MS;
    while (!this.ready() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, UPDATE_LAUNCH_POLL_MS));
    }
    if (this.ready()) {
      await this.apply();
      return;
    }
    this.sync.flush();
    this.reload();
  }

  private async publishedVersion(): Promise<string | undefined> {
    try {
      const response = await fetch(`${UPDATE_VERSION_PATH}?ngsw-bypass=true&t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        return undefined;
      }
      const body: unknown = await response.json();
      const version = (body as { version?: unknown } | null)?.version;
      return typeof version === 'string' ? version : undefined;
    } catch {
      return undefined;
    }
  }

  private takeAttempt(version: string): boolean {
    try {
      const [seen, count] = (sessionStorage.getItem(UPDATE_ATTEMPTS_KEY) ?? '').split(':');
      const attempts = seen === version ? Number(count) || 0 : 0;
      if (attempts >= UPDATE_MAX_ATTEMPTS) {
        return false;
      }
      sessionStorage.setItem(UPDATE_ATTEMPTS_KEY, `${version}:${attempts + 1}`);
      return true;
    } catch {
      return true;
    }
  }

  private forgetAttempts(): void {
    try {
      sessionStorage.removeItem(UPDATE_ATTEMPTS_KEY);
    } catch {
      return;
    }
  }
}
