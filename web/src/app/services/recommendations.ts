import { Service, computed, signal } from '@angular/core';
import { RECOMMENDATIONS_STORAGE_KEY } from '../constants';
import { Recommendation } from '../models';

function isRecommendation(value: unknown): value is Recommendation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['text'] === 'string' &&
    typeof candidate['importance'] === 'number' &&
    typeof candidate['done'] === 'boolean'
  );
}

@Service()
export class Recommendations {
  readonly items = signal<Recommendation[]>(this.restore());

  readonly sorted = computed(() =>
    this.items()
      .map((item, index) => ({ item, index }))
      .sort((a, b) => b.item.importance - a.item.importance || a.index - b.index)
      .map(({ item }) => item),
  );
  readonly total = computed(() => this.items().length);
  readonly doneCount = computed(() => this.items().filter((item) => item.done).length);

  toggleDone(id: string): void {
    this.items.update((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    );
    try {
      localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(this.items()));
    } catch {
      return;
    }
  }

  private restore(): Recommendation[] {
    try {
      const raw = localStorage.getItem(RECOMMENDATIONS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      return Array.isArray(parsed) ? parsed.filter(isRecommendation) : [];
    } catch {
      return [];
    }
  }
}
