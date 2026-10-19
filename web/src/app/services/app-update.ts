import { Service, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

@Service()
export class AppUpdate {
  readonly ready = signal(false);

  private readonly swUpdate = inject(SwUpdate);
  private started = false;

  start(): void {
    if (this.started || !this.swUpdate.isEnabled) {
      return;
    }
    this.started = true;

    this.swUpdate.versionUpdates
      .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
      .subscribe(() => this.ready.set(true));
    this.swUpdate.unrecoverable.subscribe(() => location.reload());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.check();
      }
    });
    void this.check();
  }

  async apply(): Promise<void> {
    this.ready.set(false);
    await this.swUpdate.activateUpdate();
    location.reload();
  }

  private async check(): Promise<void> {
    await this.swUpdate.checkForUpdate().catch(() => false);
  }
}
