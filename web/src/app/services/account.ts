import { Service, effect, inject, signal, untracked, computed } from '@angular/core';
import { AccountInfo, ChatApiError } from '../models';
import { Access } from './access';
import { ChatApi } from './chat-api';

@Service()
export class Account {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);

  readonly info = signal<AccountInfo | undefined>(undefined);
  readonly role = computed(() => this.info()?.role);

  constructor() {
    effect(() => {
      if (this.access.password()) {
        untracked(() => void this.refresh());
      } else {
        untracked(() => this.info.set(undefined));
      }
    });
  }

  async refresh(): Promise<void> {
    try {
      this.info.set(await this.api.me());
    } catch (error) {
      if (error instanceof ChatApiError && error.unauthorized) {
        this.access.reject();
      }
    }
  }

  async rename(name: string): Promise<void> {
    const saved = await this.api.rename(name);
    this.info.update((info) => info && { ...info, name: saved.name });
  }
}
