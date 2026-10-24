import { Service, signal } from '@angular/core';
import { SHOOT_PROGRESS_STORAGE_KEY } from '../constants';

@Service()
export class ShootProgress {
  readonly marks = signal<string[]>(this.restore());

  isDone(mark: string): boolean {
    return this.marks().includes(mark);
  }

  toggle(mark: string): void {
    this.marks.update((marks) =>
      marks.includes(mark) ? marks.filter((value) => value !== mark) : [...marks, mark],
    );
    try {
      localStorage.setItem(SHOOT_PROGRESS_STORAGE_KEY, JSON.stringify(this.marks()));
    } catch {
      return;
    }
  }

  private restore(): string[] {
    try {
      const raw = localStorage.getItem(SHOOT_PROGRESS_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
