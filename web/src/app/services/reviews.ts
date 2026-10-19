import { Service, inject, signal } from '@angular/core';
import { MAX_IDEAS_PER_PILLAR, REVIEWS_STORAGE_KEY, REVIEW_TEXTS } from '../constants';
import {
  ChatApiError,
  PlanWeek,
  ReviewAnswers,
  ReviewResult,
  StoredReview,
  Strategy,
} from '../models';
import { Access } from './access';
import { CalendarPlan } from './calendar-plan';
import { ChatApi } from './chat-api';
import { ErrorLog } from './error-log';
import { Onboarding } from './onboarding';

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isResult(value: unknown): value is ReviewResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const cadence = candidate['cadence'] as Record<string, unknown> | null;
  return (
    typeof candidate['headline'] === 'string' &&
    typeof candidate['nextFocus'] === 'string' &&
    isStringList(candidate['whatWorked']) &&
    isStringList(candidate['whatToChange']) &&
    typeof cadence === 'object' &&
    cadence !== null &&
    typeof cadence['reels'] === 'number' &&
    typeof cadence['posts'] === 'number' &&
    typeof cadence['stories'] === 'number' &&
    Array.isArray(candidate['newIdeas']) &&
    candidate['newIdeas'].every((group: unknown) => {
      if (typeof group !== 'object' || group === null) {
        return false;
      }
      const item = group as Record<string, unknown>;
      return typeof item['pillar'] === 'string' && isStringList(item['ideas']);
    })
  );
}

function isStoredReview(value: unknown): value is StoredReview {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const answers = candidate['answers'] as Record<string, unknown> | null;
  return (
    typeof candidate['weekFrom'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['applied'] === 'boolean' &&
    typeof answers === 'object' &&
    answers !== null &&
    typeof answers['bestIdea'] === 'string' &&
    typeof answers['hard'] === 'string' &&
    (answers['inquiries'] === undefined || typeof answers['inquiries'] === 'number') &&
    isResult(candidate['result'])
  );
}

@Service()
export class Reviews {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly onboarding = inject(Onboarding);
  private readonly calendar = inject(CalendarPlan);
  private readonly errorLog = inject(ErrorLog);

  readonly items = signal<Record<string, StoredReview>>(this.restore());
  readonly viewing = signal<PlanWeek | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);

  forWeek(weekFrom: string): StoredReview | undefined {
    return this.items()[weekFrom];
  }

  view(week: PlanWeek): void {
    this.error.set(undefined);
    this.viewing.set(week);
  }

  closeView(): void {
    this.viewing.set(undefined);
  }

  async submit(week: PlanWeek, answers: ReviewAnswers): Promise<boolean> {
    const profile = this.onboarding.profile();
    const strategy = this.onboarding.strategy();
    if (this.busy() || !profile || !strategy) {
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const result = await this.api.requestReview({
        profile,
        positioning: strategy.positioning,
        cadence: strategy.cadence,
        pillars: strategy.pillars.map((pillar) => ({ title: pillar.title, ideas: pillar.ideas })),
        items: week.items.map((item) => ({
          format: item.format,
          pillar: item.pillar,
          idea: item.idea,
          done: item.done,
        })),
        results: answers,
      });
      this.items.update((items) => ({
        ...items,
        [week.from]: {
          weekFrom: week.from,
          createdAt: new Date().toISOString(),
          answers,
          result,
          applied: false,
        },
      }));
      this.save();
      return true;
    } catch (error) {
      if (error instanceof ChatApiError && error.unauthorized) {
        this.access.clear();
      }
      const message = error instanceof ChatApiError ? error.message : String(error);
      this.errorLog.record('send', message);
      this.error.set(message || REVIEW_TEXTS.failed);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  apply(weekFrom: string): boolean {
    const review = this.items()[weekFrom];
    const strategy = this.onboarding.strategy();
    if (!review || !strategy) {
      return false;
    }
    const updated = this.mergeStrategy(strategy, review.result);
    this.onboarding.updateStrategy(updated);
    this.calendar.build(this.calendar.toDraft(), updated);
    this.items.update((items) => ({ ...items, [weekFrom]: { ...review, applied: true } }));
    this.save();
    return true;
  }

  private mergeStrategy(strategy: Strategy, result: ReviewResult): Strategy {
    const pillars = strategy.pillars.map((pillar) => {
      const group = result.newIdeas.find(
        (candidate) => candidate.pillar.trim().toLowerCase() === pillar.title.trim().toLowerCase(),
      );
      if (!group) {
        return pillar;
      }
      const known = new Set(pillar.ideas.map((idea) => idea.trim().toLowerCase()));
      const added = group.ideas.filter((idea) => !known.has(idea.trim().toLowerCase()));
      return { ...pillar, ideas: [...pillar.ideas, ...added].slice(-MAX_IDEAS_PER_PILLAR) };
    });
    return {
      ...strategy,
      pillars,
      cadence: {
        ...strategy.cadence,
        reels: result.cadence.reels,
        posts: result.cadence.posts,
        stories: result.cadence.stories,
      },
    };
  }

  private save(): void {
    try {
      localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(this.items()));
    } catch {
      return;
    }
  }

  private restore(): Record<string, StoredReview> {
    try {
      const raw = localStorage.getItem(REVIEWS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, StoredReview] =>
            isStoredReview(entry[1]) && entry[1].weekFrom === entry[0],
        ),
      );
    } catch {
      return {};
    }
  }
}
