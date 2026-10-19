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
    (candidate['confirmed'] === undefined || typeof candidate['confirmed'] === 'boolean')
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

  readonly total = ONBOARDING_STEPS.length;
  readonly active = computed(() => this.index() < this.total);
  readonly reviewing = computed(() => !this.active() && !this.confirmed());
  readonly step = computed<OnboardingStep | undefined>(() => ONBOARDING_STEPS[this.index()]);
  readonly profile = computed<MasterProfile | undefined>(() => {
    const answers = this.answers();
    return this.active() || !answers.specialty
      ? undefined
      : { ...answers, specialty: answers.specialty };
  });

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
    this.index.update((index) => index + 1);
    this.saveProgress();
    return { outcome: this.active() ? 'next' : 'done' };
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
    this.answers.set(cleaned);
    this.confirmed.set(true);
    this.saveProgress();
  }

  reopenReview(): void {
    this.confirmed.set(false);
    this.saveProgress();
  }

  setStrategy(strategy: Strategy): void {
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
    this.strategy.set(undefined);
    try {
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
      localStorage.removeItem(STRATEGY_STORAGE_KEY);
    } catch {
      return;
    }
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
