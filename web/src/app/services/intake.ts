import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import {
  INTAKE_MAX_LINKS,
  INTAKE_MAX_NOTE_LENGTH,
  INTAKE_MAX_REFERENCES,
  INTAKE_MIN_REFERENCES,
  INTAKE_POLL_MS,
  INTAKE_SEEN_STORAGE_KEY,
  INTAKE_TEXTS,
} from '../constants';
import { ChatApiError, IntakeDraft, IntakeGoalId, IntakeRequest } from '../models';
import { Access } from './access';
import { Account } from './account';
import { ChatApi } from './chat-api';
import { ErrorLog } from './error-log';
import { Sync } from './sync';

function referenceSlots(urls: readonly string[]): string[] {
  return [...urls, ...Array<string>(Math.max(INTAKE_MIN_REFERENCES - urls.length, 0)).fill('')];
}

function emptyDraft(): IntakeDraft {
  return { links: [''], references: referenceSlots([]), goals: [], note: '' };
}

function draftOf(request: IntakeRequest, withNote: boolean): IntakeDraft {
  return {
    links: request.networks.length > 0 ? request.networks.map((network) => network.url) : [''],
    references: referenceSlots((request.references ?? []).map((network) => network.url)),
    goals: [...request.goals],
    note: withNote ? (request.note ?? '') : '',
  };
}

@Service()
export class Intake {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly account = inject(Account);
  private readonly sync = inject(Sync);
  private readonly errorLog = inject(ErrorLog);
  private readonly router = inject(Router);

  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly request = signal<IntakeRequest | undefined>(undefined);
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly editing = signal(false);
  readonly reviewMode = signal(false);
  readonly draft = signal<IntakeDraft>(emptyDraft());

  readonly pending = computed(() => this.request()?.status === 'new');
  readonly ready = computed(() => this.request()?.status === 'ready');
  readonly reviewWaiting = computed(() => this.request()?.review === true && this.pending());
  readonly showForm = computed(() => this.request() === undefined || this.editing());
  readonly reviewing = computed(() =>
    this.showForm() ? this.reviewMode() : this.request()?.review === true,
  );
  readonly canSubmit = computed(() => {
    const draft = this.draft();
    return (
      !this.busy() &&
      draft.goals.length > 0 &&
      draft.links.some((link) => link.trim().length > 0) &&
      draft.note.length <= INTAKE_MAX_NOTE_LENGTH
    );
  });

  constructor() {
    effect(() => {
      if (this.account.role() === 'master') {
        untracked(() => void this.refresh());
      } else {
        untracked(() => this.reset());
      }
    });
  }

  async refresh(): Promise<void> {
    try {
      const latest = await this.api.latestIntake();
      this.request.set(latest);
      this.error.set(undefined);
      this.loaded.set(true);
      this.adopt(latest);
    } catch (error) {
      this.handleFailure(error, INTAKE_TEXTS.loadFailed);
    }
    this.schedule();
  }

  async submit(): Promise<boolean> {
    if (!this.canSubmit()) {
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const draft = this.draft();
      this.request.set(
        await this.api.submitIntake({
          links: draft.links.map((link) => link.trim()).filter(Boolean),
          references: draft.references.map((link) => link.trim()).filter(Boolean),
          goals: draft.goals,
          note: draft.note.trim(),
          ...(this.reviewMode() ? { review: true } : {}),
        }),
      );
      this.editing.set(false);
      this.reviewMode.set(false);
      this.schedule();
      return true;
    } catch (error) {
      this.handleFailure(error, INTAKE_TEXTS.failed);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  edit(): void {
    const request = this.request();
    if (request) {
      this.draft.set(draftOf(request, true));
    }
    this.error.set(undefined);
    this.reviewMode.set(request?.review === true);
    this.editing.set(true);
  }

  askForReview(): void {
    this.startNew();
    this.reviewMode.set(true);
    void this.router.navigateByUrl('/intake');
  }

  startNew(): void {
    const request = this.request();
    this.draft.set(request ? draftOf(request, false) : emptyDraft());
    this.error.set(undefined);
    this.reviewMode.set(false);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.reviewMode.set(false);
    this.error.set(undefined);
  }

  setLink(index: number, value: string): void {
    this.draft.update((draft) => ({
      ...draft,
      links: draft.links.map((link, position) => (position === index ? value : link)),
    }));
  }

  addLink(): void {
    this.draft.update((draft) =>
      draft.links.length >= INTAKE_MAX_LINKS ? draft : { ...draft, links: [...draft.links, ''] },
    );
  }

  removeLink(index: number): void {
    this.draft.update((draft) => {
      const links = draft.links.filter((_, position) => position !== index);
      return { ...draft, links: links.length > 0 ? links : [''] };
    });
  }

  setReference(index: number, value: string): void {
    this.draft.update((draft) => ({
      ...draft,
      references: draft.references.map((link, position) => (position === index ? value : link)),
    }));
  }

  addReference(): void {
    this.draft.update((draft) =>
      draft.references.length >= INTAKE_MAX_REFERENCES
        ? draft
        : { ...draft, references: [...draft.references, ''] },
    );
  }

  removeReference(index: number): void {
    this.draft.update((draft) => ({
      ...draft,
      references: referenceSlots(draft.references.filter((_, position) => position !== index)),
    }));
  }

  toggleGoal(id: IntakeGoalId): void {
    this.draft.update((draft) => ({
      ...draft,
      goals: draft.goals.includes(id)
        ? draft.goals.filter((goal) => goal !== id)
        : [...draft.goals, id],
    }));
  }

  setNote(value: string): void {
    this.draft.update((draft) => ({ ...draft, note: value }));
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  markSeen(): void {
    const readyAt = this.request()?.readyAt;
    if (!readyAt) {
      return;
    }
    try {
      localStorage.setItem(INTAKE_SEEN_STORAGE_KEY, readyAt);
    } catch {
      return;
    }
  }

  private reset(): void {
    this.stop();
    this.request.set(undefined);
    this.loaded.set(false);
    this.editing.set(false);
    this.reviewMode.set(false);
    this.draft.set(emptyDraft());
    this.error.set(undefined);
  }

  private adopt(latest: IntakeRequest | undefined): void {
    if (!latest) {
      return;
    }
    if (latest.status === 'new' && !this.editing() && this.draftIsPristine()) {
      this.draft.set(draftOf(latest, true));
    }
    if (latest.status === 'ready' && latest.readyAt && latest.readyAt !== this.seenReadyAt()) {
      void this.router.navigateByUrl('/intake');
      void this.sync.pull();
    }
  }

  private draftIsPristine(): boolean {
    const draft = this.draft();
    return (
      draft.goals.length === 0 &&
      draft.note === '' &&
      draft.links.every((link) => link === '') &&
      draft.references.every((link) => link === '')
    );
  }

  private seenReadyAt(): string | undefined {
    try {
      return localStorage.getItem(INTAKE_SEEN_STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private schedule(): void {
    this.stop();
    if (this.pending()) {
      this.timer = setTimeout(() => void this.refresh(), INTAKE_POLL_MS);
    }
  }

  private handleFailure(error: unknown, fallback: string): void {
    if (error instanceof ChatApiError && error.unauthorized) {
      this.access.clear();
    }
    const message = error instanceof ChatApiError ? error.message : String(error);
    this.errorLog.record('send', message);
    this.error.set(message || fallback);
  }
}
