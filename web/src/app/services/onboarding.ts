import { Service, computed, signal } from '@angular/core';
import {
  MAX_ANSWER_RUNES,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  SKIP_WORDS,
  STRATEGY_STORAGE_KEY,
} from '../constants';
import {
  AnswerResult,
  MasterProfile,
  OnboardingStep,
  ProfileDraft,
  ProfileField,
  Strategy,
  StoredOnboarding,
} from '../models';
import { validateAnswer } from '../utils/answer-validation';

function isStrategy(value: unknown): value is Strategy {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['summary'] === 'string' &&
    typeof candidate['positioning'] === 'string' &&
    Array.isArray(candidate['profileFixes']) &&
    Array.isArray(candidate['pillars']) &&
    Array.isArray(candidate['firstSteps']) &&
    typeof candidate['cadence'] === 'object' &&
    candidate['cadence'] !== null
  );
}

function isStoredOnboarding(value: unknown): value is StoredOnboarding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['index'] === 'number' &&
    Number.isInteger(candidate['index']) &&
    candidate['index'] >= 0 &&
    candidate['index'] <= ONBOARDING_STEPS.length &&
    typeof candidate['answers'] === 'object' &&
    candidate['answers'] !== null &&
    (candidate['confirmed'] === undefined || typeof candidate['confirmed'] === 'boolean') &&
    (candidate['started'] === undefined || typeof candidate['started'] === 'boolean') &&
    (candidate['resumeIndex'] === undefined ||
      (typeof candidate['resumeIndex'] === 'number' &&
        Number.isInteger(candidate['resumeIndex']) &&
        candidate['resumeIndex'] >= 0 &&
        candidate['resumeIndex'] <= ONBOARDING_STEPS.length))
  );
}

function clip(text: string): string {
  const letters = Array.from(text.trim().replace(/\s+/g, ' '));
  return letters.length > MAX_ANSWER_RUNES
    ? letters.slice(0, MAX_ANSWER_RUNES).join('')
    : letters.join('');
}

function isSkip(text: string): boolean {
  return SKIP_WORDS.includes(text.trim().toLowerCase());
}

@Service()
export class Onboarding {
  private readonly stored = this.restoreProgress();

  readonly answers = signal<Partial<MasterProfile>>(this.stored.answers);
  readonly index = signal(this.stored.index);
  readonly strategy = signal<Strategy | undefined>(this.restoreStrategy());
  readonly confirmed = signal(this.stored.confirmed ?? this.strategy() !== undefined);
  readonly resumeIndex = signal<number | undefined>(this.stored.resumeIndex);
  readonly started = signal(this.stored.started ?? this.hasProgress());
  readonly strategyRevision = signal(0);

  readonly total = ONBOARDING_STEPS.length;
  readonly active = computed(() => this.started() && this.index() < this.total);
  readonly editing = computed(() => this.resumeIndex() !== undefined);
  readonly reviewing = computed(
    () => this.started() && this.index() >= this.total && !this.confirmed(),
  );
  readonly step = computed<OnboardingStep | undefined>(() => ONBOARDING_STEPS[this.index()]);
  readonly profile = computed<MasterProfile | undefined>(() => {
    const answers = this.answers();
    return (this.active() && !this.editing()) || !answers.specialty
      ? undefined
      : { ...answers, specialty: answers.specialty };
  });

  start(): void {
    this.started.set(true);
    this.saveProgress();
  }

  answer(text: string): AnswerResult {
    const step = this.step();
    if (!step) {
      return { outcome: 'done' };
    }
    const skipped = isSkip(text) || text.trim().length === 0;
    if (skipped && step.required) {
      return { outcome: 'repeat' };
    }
    if (!skipped) {
      const reason = validateAnswer(step, text);
      if (reason) {
        return { outcome: 'invalid', reason };
      }
      this.answers.update((answers) => ({ ...answers, [step.field]: clip(text) }));
    } else {
      this.answers.update((answers) => this.without(answers, step.field));
    }
    this.advance();
    this.saveProgress();
    return { outcome: this.active() ? 'next' : 'done' };
  }

  startEdit(field: ProfileField): boolean {
    const target = ONBOARDING_STEPS.findIndex((step) => step.field === field);
    if (target < 0) {
      return false;
    }
    if (target !== this.index() && this.resumeIndex() === undefined) {
      this.resumeIndex.set(this.index());
    }
    this.index.set(target);
    this.saveProgress();
    return true;
  }

  back(): boolean {
    if (this.index() === 0 || !this.active()) {
      return false;
    }
    this.index.update((index) => index - 1);
    this.saveProgress();
    return true;
  }

  currentAnswer(): string | undefined {
    const step = this.step();
    return step ? this.answers()[step.field] : undefined;
  }

  toDraft(): ProfileDraft {
    const answers = this.answers();
    return {
      specialty: answers.specialty ?? '',
      name: answers.name ?? '',
      city: answers.city ?? '',
      experience: answers.experience ?? '',
      services: answers.services ?? '',
      clients: answers.clients ?? '',
      goal: answers.goal ?? '',
      instagram: answers.instagram ?? '',
      style: answers.style ?? '',
      audit: answers.audit ?? '',
    };
  }

  saveDraft(draft: ProfileDraft): void {
    const cleaned: Partial<MasterProfile> = {};
    ONBOARDING_STEPS.forEach((step) => {
      const value = clip(draft[step.field]);
      if (value) {
        cleaned[step.field] = value;
      }
    });
    const audit = this.answers().audit;
    if (audit) {
      cleaned.audit = audit;
    }
    this.answers.set(cleaned);
    this.confirmed.set(true);
    this.saveProgress();
  }

  private advance(): void {
    const resume = this.resumeIndex();
    if (resume === undefined) {
      this.index.update((index) => index + 1);
      return;
    }
    this.index.set(resume);
    this.resumeIndex.set(undefined);
    if (resume >= this.total) {
      this.confirmed.set(false);
    }
  }

  setAudit(digest: string | undefined): void {
    this.answers.update((answers) =>
      digest ? { ...answers, audit: digest } : this.without(answers, 'audit'),
    );
    this.saveProgress();
  }

  reopenReview(): void {
    this.confirmed.set(false);
    this.saveProgress();
  }

  setStrategy(strategy: Strategy): void {
    this.strategyRevision.update((revision) => revision + 1);
    this.updateStrategy(strategy);
  }

  updateStrategy(strategy: Strategy): void {
    this.strategy.set(strategy);
    try {
      localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(strategy));
    } catch {
      return;
    }
  }

  reset(): void {
    this.answers.set({});
    this.index.set(0);
    this.confirmed.set(false);
    this.resumeIndex.set(undefined);
    this.started.set(false);
    this.strategy.set(undefined);
    try {
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      localStorage.removeItem(STRATEGY_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private hasProgress(): boolean {
    return (
      this.stored.index > 0 ||
      this.stored.confirmed === true ||
      Object.keys(this.stored.answers).length > 0 ||
      this.strategy() !== undefined
    );
  }

  private without(answers: Partial<MasterProfile>, field: ProfileField): Partial<MasterProfile> {
    const rest = { ...answers };
    delete rest[field];
    return rest;
  }

  private saveProgress(): void {
    const progress: StoredOnboarding = {
      index: this.index(),
      answers: this.answers(),
      confirmed: this.confirmed(),
      resumeIndex: this.resumeIndex(),
      started: this.started(),
    };
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
    } catch {
      return;
    }
  }

  private restoreProgress(): StoredOnboarding {
    try {
      const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (isStoredOnboarding(parsed)) {
        return parsed;
      }
    } catch {
      return { index: 0, answers: {} };
    }
    return { index: 0, answers: {} };
  }

  private restoreStrategy(): Strategy | undefined {
    try {
      const raw = localStorage.getItem(STRATEGY_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      return isStrategy(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
