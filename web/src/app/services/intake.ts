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
  MAX_BEST_POST_LENGTH,
  STAT_PATTERN,
  TIME_PATTERN,
} from '../constants';
import {
  IntakeDraft,
  IntakeGoalId,
  IntakeRequest,
  IntakeSchedule,
  IntakeScheduleDraft,
  IntakeStatField,
  IntakeStats,
  IntakeStatsDraft,
  IntakeTimeField,
} from '../models';
import { browserTimeZone } from '../utils/time-zone';
import { Account } from './account';
import { ApiClient } from './api-client';
import { ClientErrors } from './client-errors';
import { Sync } from './sync';

function referenceSlots(urls: readonly string[]): string[] {
  return [...urls, ...Array<string>(Math.max(INTAKE_MIN_REFERENCES - urls.length, 0)).fill('')];
}

function readSeenReadyAt(): string | undefined {
  try {
    return localStorage.getItem(INTAKE_SEEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function emptyStats(): IntakeStatsDraft {
  return { followers: '', reach: '', bestPost: '' };
}

function statsDraftOf(stats: IntakeStats | undefined): IntakeStatsDraft {
  return {
    followers: stats?.followers === undefined ? '' : String(stats.followers),
    reach: stats?.reach === undefined ? '' : String(stats.reach),
    bestPost: stats?.bestPost ?? '',
  };
}

function statNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

function statsValid(stats: IntakeStatsDraft): boolean {
  return (
    [stats.followers, stats.reach].every(
      (value) => value.trim() === '' || STAT_PATTERN.test(value.trim()),
    ) && stats.bestPost.length <= MAX_BEST_POST_LENGTH
  );
}

function statsOf(draft: IntakeStatsDraft): IntakeStats | undefined {
  const followers = statNumber(draft.followers);
  const reach = statNumber(draft.reach);
  const bestPost = draft.bestPost.trim();
  if (followers === undefined && reach === undefined && bestPost === '') {
    return undefined;
  }
  return {
    ...(followers === undefined ? {} : { followers }),
    ...(reach === undefined ? {} : { reach }),
    ...(bestPost === '' ? {} : { bestPost }),
  };
}

function emptySchedule(): IntakeScheduleDraft {
  return { shootDays: [], shootTime: '', publishTime: '' };
}

function scheduleDraftOf(schedule: IntakeSchedule | undefined): IntakeScheduleDraft {
  return {
    shootDays: [...(schedule?.shootDays ?? [])],
    shootTime: schedule?.shootTime ?? '',
    publishTime: schedule?.publishTime ?? '',
  };
}

function timeValid(value: string): boolean {
  return value === '' || TIME_PATTERN.test(value);
}

function scheduleValid(schedule: IntakeScheduleDraft): boolean {
  return timeValid(schedule.shootTime) && timeValid(schedule.publishTime);
}

function scheduleOf(draft: IntakeScheduleDraft): IntakeSchedule | undefined {
  if (draft.shootDays.length === 0 && draft.shootTime === '' && draft.publishTime === '') {
    return undefined;
  }
  return {
    shootDays: [...draft.shootDays].sort((left, right) => left - right),
    ...(draft.shootTime === '' ? {} : { shootTime: draft.shootTime }),
    ...(draft.publishTime === '' ? {} : { publishTime: draft.publishTime }),
  };
}

function emptyDraft(): IntakeDraft {
  return {
    links: [''],
    references: referenceSlots([]),
    goals: [],
    note: '',
    city: '',
    stats: emptyStats(),
    schedule: emptySchedule(),
  };
}

function draftOf(request: IntakeRequest, withNote: boolean): IntakeDraft {
  return {
    links: request.networks.length > 0 ? request.networks.map((network) => network.url) : [''],
    references: referenceSlots((request.references ?? []).map((network) => network.url)),
    goals: [...request.goals],
    note: withNote ? (request.note ?? '') : '',
    city: request.city ?? '',
    stats: withNote ? statsDraftOf(request.stats) : emptyStats(),
    schedule: scheduleDraftOf(request.schedule),
  };
}

@Service()
export class Intake {
  private readonly api = inject(ApiClient);
  private readonly clientErrors = inject(ClientErrors);
  private readonly account = inject(Account);
  private readonly sync = inject(Sync);
  private readonly router = inject(Router);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly seenReadyAt = signal(readSeenReadyAt());

  readonly request = signal<IntakeRequest | undefined>(undefined);
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly editing = signal(false);
  readonly reviewMode = signal(false);
  readonly draft = signal<IntakeDraft>(emptyDraft());

  readonly pending = computed(() => this.request()?.status === 'new');
  readonly ready = computed(() => this.request()?.status === 'ready');
  readonly readyUnseen = computed(() => {
    const readyAt = this.request()?.readyAt;
    return this.ready() && readyAt !== undefined && readyAt !== this.seenReadyAt();
  });
  readonly reviewWaiting = computed(() => this.request()?.review === true && this.pending());
  readonly connecting = computed(() => !this.account.signedIn());
  readonly showForm = computed(
    () => this.editing() || (this.loaded() && this.request() === undefined),
  );
  readonly reviewing = computed(() =>
    this.showForm() ? this.reviewMode() : this.request()?.review === true,
  );
  readonly statsValid = computed(() => statsValid(this.draft().stats));
  readonly scheduleValid = computed(() => scheduleValid(this.draft().schedule));
  readonly canSubmit = computed(() => {
    const draft = this.draft();
    return (
      !this.busy() &&
      draft.goals.length > 0 &&
      draft.links.some((link) => link.trim().length > 0) &&
      draft.note.length <= INTAKE_MAX_NOTE_LENGTH &&
      this.scheduleValid() &&
      (!this.reviewMode() || this.statsValid())
    );
  });

  constructor() {
    effect(() => {
      if (this.account.signedIn()) {
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

  async retry(): Promise<void> {
    if (this.connecting()) {
      await this.account.refresh();
      return;
    }
    await this.refresh();
  }

  async submit(): Promise<boolean> {
    if (!this.canSubmit()) {
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const draft = this.draft();
      const stats = this.reviewMode() ? statsOf(draft.stats) : undefined;
      const schedule = scheduleOf(draft.schedule);
      this.request.set(
        await this.api.submitIntake({
          links: draft.links.map((link) => link.trim()).filter(Boolean),
          references: draft.references.map((link) => link.trim()).filter(Boolean),
          goals: draft.goals,
          note: draft.note.trim(),
          city: draft.city.trim(),
          timeZone: browserTimeZone(),
          ...(this.reviewMode() ? { review: true } : {}),
          ...(stats ? { stats } : {}),
          ...(schedule ? { schedule } : {}),
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

  setCity(value: string): void {
    this.draft.update((draft) => ({ ...draft, city: value }));
  }

  setNote(value: string): void {
    this.draft.update((draft) => ({ ...draft, note: value }));
  }

  setStat(field: IntakeStatField, value: string): void {
    this.draft.update((draft) => ({ ...draft, stats: { ...draft.stats, [field]: value } }));
  }

  toggleShootDay(day: number): void {
    this.draft.update((draft) => {
      const shootDays = draft.schedule.shootDays.includes(day)
        ? draft.schedule.shootDays.filter((chosen) => chosen !== day)
        : [...draft.schedule.shootDays, day];
      return { ...draft, schedule: { ...draft.schedule, shootDays } };
    });
  }

  setTime(field: IntakeTimeField, value: string): void {
    this.draft.update((draft) => ({
      ...draft,
      schedule: { ...draft.schedule, [field]: value.trim() },
    }));
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
    this.seenReadyAt.set(readyAt);
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
      void this.sync.pull();
    }
  }

  private draftIsPristine(): boolean {
    const draft = this.draft();
    return (
      draft.goals.length === 0 &&
      draft.note === '' &&
      draft.city === '' &&
      Object.values(draft.stats).every((value) => value === '') &&
      draft.schedule.shootDays.length === 0 &&
      draft.schedule.shootTime === '' &&
      draft.schedule.publishTime === '' &&
      draft.links.every((link) => link === '') &&
      draft.references.every((link) => link === '')
    );
  }

  private schedule(): void {
    this.stop();
    if (this.pending()) {
      this.timer = setTimeout(() => void this.refresh(), INTAKE_POLL_MS);
    }
  }

  private handleFailure(error: unknown, fallback: string): void {
    this.error.set(this.clientErrors.report(error, 'intake', fallback));
  }
}
