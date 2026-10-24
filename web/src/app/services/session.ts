import { Service, inject } from '@angular/core';
import {
  STORAGE_PREFIX,
  THEME_STORAGE_KEY,
  SCALE_STORAGE_KEY,
  SPEAK_REPLIES_STORAGE_KEY,
} from '../constants';
import { Access } from './access';
import { PAGE_RELOAD } from './page-reload';
import { PushNotifications } from './push-notifications';
import { Sync } from './sync';

const KEPT_STORAGE_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  SCALE_STORAGE_KEY,
  SPEAK_REPLIES_STORAGE_KEY,
];

@Service()
export class Session {
  private readonly access = inject(Access);
  private readonly sync = inject(Sync);
  private readonly pushNotifications = inject(PushNotifications);
  private readonly reload = inject(PAGE_RELOAD);

  async logout(): Promise<boolean> {
    if (!(await this.sync.settle())) {
      return false;
    }
    await this.pushNotifications.disable();
    this.wipeLocalData();
    this.access.clear();
    this.reload();
    return true;
  }

  private wipeLocalData(): void {
    try {
      const keys = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      );
      keys
        .filter((key): key is string => key !== null && key.startsWith(STORAGE_PREFIX))
        .filter((key) => !KEPT_STORAGE_KEYS.includes(key))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      return;
    }
  }
}
