import { Service, computed, inject, signal } from '@angular/core';
import {
  API_MESSAGES,
  IDEA_REQUESTS_STORAGE_KEY,
  IDEA_REQUEST_TEXTS,
  MAX_IDEA_REQUEST_TEXT,
} from '../constants';
import { ApiError, IdeaRequestMark, IdeaRequestMarks, PlanItem } from '../models';
import { Access } from './access';
import { ApiClient } from './api-client';

function isMark(value: unknown): value is IdeaRequestMark {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate['idea'] === 'string' && typeof candidate['sentAt'] === 'string';
}

function readMarks(): IdeaRequestMarks {
  try {
    const raw = localStorage.getItem(IDEA_REQUESTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, IdeaRequestMark] => isMark(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

@Service()
export class IdeaRequests {
  private readonly api = inject(ApiClient);
  private readonly access = inject(Access);

  readonly marks = signal<IdeaRequestMarks>(readMarks());
  readonly text = signal('');
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | undefined>(undefined);

  readonly canSubmit = computed(
    () =>
      !this.busy() && this.text().trim().length > 0 && this.text().length <= MAX_IDEA_REQUEST_TEXT,
  );

  requested(item: PlanItem): boolean {
    return this.marks()[item.id]?.idea === item.idea;
  }

  setText(value: string): void {
    this.text.set(value.slice(0, MAX_IDEA_REQUEST_TEXT));
  }

  reset(): void {
    this.text.set('');
    this.sent.set(false);
    this.error.set(undefined);
  }

  async submit(item: PlanItem): Promise<boolean> {
    if (!this.canSubmit()) {
      this.error.set(IDEA_REQUEST_TEXTS.empty);
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      await this.api.sendFeedback({ text: this.text().trim(), contact: '', itemId: item.id });
      this.marks.update((marks) => ({
        ...marks,
        [item.id]: { idea: item.idea, sentAt: new Date().toISOString() },
      }));
      this.persist();
      this.text.set('');
      this.sent.set(true);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.unauthorized) {
        this.access.clear();
      }
      this.error.set(error instanceof ApiError ? error.message : API_MESSAGES.failed);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(IDEA_REQUESTS_STORAGE_KEY, JSON.stringify(this.marks()));
    } catch {
      return;
    }
  }
}
