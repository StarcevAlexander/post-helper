import { Service, computed, signal } from '@angular/core';
import { ACCESS_PASSWORD_STORAGE_KEY } from '../constants';

@Service()
export class Access {
  readonly password = signal(this.read());
  readonly granted = computed(() => this.password().length > 0);
  readonly rejected = signal(false);

  save(password: string): void {
    const trimmed = password.trim();
    this.rejected.set(false);
    this.password.set(trimmed);
    try {
      localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, trimmed);
    } catch {
      return;
    }
  }

  reject(): void {
    this.clear();
    this.rejected.set(true);
  }

  clear(): void {
    this.password.set('');
    try {
      localStorage.removeItem(ACCESS_PASSWORD_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private read(): string {
    try {
      return localStorage.getItem(ACCESS_PASSWORD_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
