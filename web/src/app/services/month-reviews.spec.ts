import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CALENDAR_STORAGE_KEY, MONTH_REVIEWS_STORAGE_KEY } from '../constants';
import { MonthReview } from '../models';
import { addDays, toDateKey } from '../utils/date-utils';
import { MonthReviews } from './month-reviews';

function review(id: string): MonthReview {
  return {
    id,
    from: '2026-10-20',
    to: '2026-11-16',
    planned: 16,
    done: 12,
    headline: `Итог ${id}`,
    facts: ['Подписчиков 340, было 310'],
    conclusions: ['Сторис дали больше всего ответов'],
    changes: [],
    note: '',
  };
}

function planEndingIn(days: number): void {
  const date = toDateKey(addDays(new Date(), days));
  localStorage.setItem(
    CALENDAR_STORAGE_KEY,
    JSON.stringify({
      schedule: { slots: [{ weekday: 1, time: '11:00' }], publishTime: '19:00' },
      items: [
        {
          id: 'm1-w4',
          date,
          time: '19:00',
          format: 'post',
          pillar: 'Процесс',
          idea: 'Кадр',
          done: false,
        },
      ],
      startedOn: toDateKey(new Date()),
    }),
  );
}

describe('MonthReviews', () => {
  function setUp(): MonthReviews {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    return TestBed.inject(MonthReviews);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts empty and not due without a plan', () => {
    const reviews = setUp();

    expect(reviews.items()).toEqual([]);
    expect(reviews.due()).toBe(false);
    expect(reviews.available()).toBe(false);
  });

  it('keeps the delivered reviews, newest first, and drops broken ones', () => {
    localStorage.setItem(
      MONTH_REVIEWS_STORAGE_KEY,
      JSON.stringify([review('m1'), { id: 'x', headline: 5 }, review('m2')]),
    );

    const reviews = setUp();

    expect(reviews.items().map((item) => item.id)).toEqual(['m1', 'm2']);
    expect(reviews.latestFirst().map((item) => item.id)).toEqual(['m2', 'm1']);
    expect(reviews.available()).toBe(true);
  });

  it('survives a corrupted store', () => {
    localStorage.setItem(MONTH_REVIEWS_STORAGE_KEY, '{not json');

    expect(setUp().items()).toEqual([]);
  });

  it('becomes due when the calendar ends within three days', () => {
    planEndingIn(2);

    const reviews = setUp();

    expect(reviews.daysLeft()).toBe(2);
    expect(reviews.due()).toBe(true);
  });

  it('is not due while the calendar still has more than three days', () => {
    planEndingIn(10);

    const reviews = setUp();

    expect(reviews.daysLeft()).toBe(10);
    expect(reviews.due()).toBe(false);
    expect(reviews.available()).toBe(true);
  });

  it('is still due once the calendar is over', () => {
    planEndingIn(-5);

    expect(setUp().due()).toBe(true);
  });
});
