import { Service, inject, signal } from '@angular/core';
import { NOTICE_TEXTS } from '../constants';
import { ApiError, NoticeView } from '../models';
import { ApiClient } from './api-client';
import { Sync } from './sync';

@Service()
export class Notices {
  private readonly api = inject(ApiClient);
  private readonly sync = inject(Sync);

  readonly items = signal<NoticeView[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.sync.settle();
      this.items.set(await this.api.notices());
    } catch (error) {
      this.error.set(error instanceof ApiError ? error.message : NOTICE_TEXTS.failed);
    } finally {
      this.loading.set(false);
    }
  }

  async recheck(id: string): Promise<NoticeView> {
    await this.sync.settle();
    const fresh = await this.api.notice(id);
    this.items.update((items) => items.map((item) => (item.id === id ? fresh : item)));
    return fresh;
  }
}
