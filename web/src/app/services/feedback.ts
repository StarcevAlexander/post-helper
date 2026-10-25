import { Service, computed, inject, signal } from '@angular/core';
import {
  API_MESSAGES,
  FEEDBACK_CONTACT_STORAGE_KEY,
  FEEDBACK_TEXTS,
  MAX_FEEDBACK_CONTACT,
  MAX_FEEDBACK_TEXT,
} from '../constants';
import { ApiError } from '../models';
import { Access } from './access';
import { ApiClient } from './api-client';

@Service()
export class Feedback {
  private readonly api = inject(ApiClient);
  private readonly access = inject(Access);

  readonly text = signal('');
  readonly contact = signal(this.restoreContact());
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | undefined>(undefined);

  readonly canSubmit = computed(
    () =>
      !this.busy() &&
      this.text().trim().length > 0 &&
      this.text().length <= MAX_FEEDBACK_TEXT &&
      this.contact().length <= MAX_FEEDBACK_CONTACT,
  );

  setText(value: string): void {
    this.text.set(value.slice(0, MAX_FEEDBACK_TEXT));
  }

  setContact(value: string): void {
    this.contact.set(value.slice(0, MAX_FEEDBACK_CONTACT));
  }

  startNew(): void {
    this.sent.set(false);
    this.error.set(undefined);
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      this.error.set(FEEDBACK_TEXTS.empty);
      return;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      await this.api.sendFeedback({ text: this.text().trim(), contact: this.contact().trim() });
      this.saveContact();
      this.text.set('');
      this.sent.set(true);
    } catch (error) {
      if (error instanceof ApiError && error.unauthorized) {
        this.access.clear();
      }
      this.error.set(error instanceof ApiError ? error.message : API_MESSAGES.failed);
    } finally {
      this.busy.set(false);
    }
  }

  private restoreContact(): string {
    try {
      return (localStorage.getItem(FEEDBACK_CONTACT_STORAGE_KEY) ?? '').slice(
        0,
        MAX_FEEDBACK_CONTACT,
      );
    } catch {
      return '';
    }
  }

  private saveContact(): void {
    try {
      localStorage.setItem(FEEDBACK_CONTACT_STORAGE_KEY, this.contact().trim());
    } catch {
      return;
    }
  }
}
