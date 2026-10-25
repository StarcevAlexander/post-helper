import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { AccountInfo, ApiError } from '../models';
import { Access } from './access';
import { ApiClient } from './api-client';

@Service()
export class Account {
  private readonly api = inject(ApiClient);
  private readonly access = inject(Access);

  readonly info = signal<AccountInfo | undefined>(undefined);
  readonly signedIn = computed(() => this.info() !== undefined);

  constructor() {
    effect(() => {
      if (this.access.password()) {
        untracked(() => void this.refresh());
      } else {
        untracked(() => this.info.set(undefined));
      }
    });

    if (typeof document !== 'undefined') {
      const retry = () => {
        if (this.access.granted() && !this.signedIn()) {
          void this.refresh();
        }
      };
      window.addEventListener('online', retry);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          retry();
        }
      });
    }
  }

  async refresh(): Promise<void> {
    try {
      this.info.set(await this.api.me());
    } catch (error) {
      if (error instanceof ApiError && error.unauthorized) {
        this.access.reject();
      }
    }
  }

  async rename(name: string): Promise<void> {
    const saved = await this.api.rename(name);
    this.info.update((info) => info && { ...info, name: saved.name });
  }
}
