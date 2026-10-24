import { TestBed } from '@angular/core/testing';
import { RECOMMENDATIONS_STORAGE_KEY } from '../constants';
import { Recommendations } from './recommendations';

const stored = [
  { id: 'r1', text: 'Обновить аватар', importance: 40, done: false },
  { id: 'r2', text: 'Добавить запись в шапку', importance: 90, done: false },
  { id: 'r3', text: 'Закрепить отзывы', importance: 90, done: true },
];

describe('Recommendations', () => {
  function setUp(): Recommendations {
    TestBed.resetTestingModule();
    return TestBed.inject(Recommendations);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    const recommendations = setUp();

    expect(recommendations.items()).toEqual([]);
    expect(recommendations.total()).toBe(0);
    expect(recommendations.doneCount()).toBe(0);
  });

  it('lists the most important first and keeps the delivered order among equals', () => {
    localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(stored));

    const recommendations = setUp();

    expect(recommendations.sorted().map((item) => item.id)).toEqual(['r2', 'r3', 'r1']);
    expect(recommendations.total()).toBe(3);
    expect(recommendations.doneCount()).toBe(1);
  });

  it('marks a recommendation as done and remembers it', () => {
    localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(stored));
    const recommendations = setUp();

    recommendations.toggleDone('r1');

    expect(recommendations.doneCount()).toBe(2);
    const saved = JSON.parse(localStorage.getItem(RECOMMENDATIONS_STORAGE_KEY) ?? '[]');
    expect(saved.find((item: { id: string }) => item.id === 'r1').done).toBe(true);
    recommendations.toggleDone('r1');
    expect(recommendations.doneCount()).toBe(1);
  });

  it('drops broken records and survives a corrupted store', () => {
    localStorage.setItem(
      RECOMMENDATIONS_STORAGE_KEY,
      JSON.stringify([stored[0], { id: 'x', text: 5 }, 'junk']),
    );
    expect(setUp().items()).toEqual([stored[0]]);

    localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, '{not json');
    expect(setUp().items()).toEqual([]);
  });
});
