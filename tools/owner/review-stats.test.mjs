import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReviewStats, describeReviewStats } from './review-stats.mjs';

function item(id, date, overrides = {}) {
  return { id, date, time: '19:00', format: 'reels', pillar: 'До и после', idea: `Идея ${id}`, done: false, ...overrides };
}

function exported(items, extra = {}) {
  return {
    master: { name: 'Анна' },
    state: { data: { calendar: { startedOn: '2026-10-01', schedule: { slots: [], publishTime: '19:00' }, items }, ...extra } },
  };
}

test('reports a missing calendar without numbers', () => {
  const stats = buildReviewStats({ master: { name: 'Анна' }, state: { data: {} } }, '2026-10-30');

  assert.equal(stats.hasPlan, false);
  assert.match(describeReviewStats(stats), /календаря нет/);
});

test('counts done items, share of due items and overdue ones', () => {
  const items = [
    item('a', '2026-10-02', { done: true }),
    item('b', '2026-10-05'),
    item('c', '2026-10-09', { format: 'post', pillar: 'Процесс', done: true }),
    item('d', '2026-11-20'),
  ];

  const stats = buildReviewStats(exported(items), '2026-10-10');

  assert.equal(stats.total, 4);
  assert.equal(stats.done, 2);
  assert.equal(stats.donePercent, 50);
  assert.equal(stats.dueCount, 3);
  assert.equal(stats.dueDone, 2);
  assert.equal(stats.dueDonePercent, 67);
  assert.deepEqual(stats.overdue.map((entry) => entry.id), ['b']);
  assert.equal(stats.planFinished, false);
  assert.equal(stats.daysLeft, 41);
});

test('groups by week, format and pillar', () => {
  const items = [
    item('a', '2026-10-02', { done: true }),
    item('b', '2026-10-09', { format: 'post', pillar: 'Процесс' }),
    item('c', '2026-10-10', { format: 'post', pillar: 'Процесс', done: true }),
  ];

  const stats = buildReviewStats(exported(items), '2026-10-31');

  assert.deepEqual(stats.byWeek.map((week) => [week.name, week.done, week.planned]), [
    ['неделя 1', 1, 1],
    ['неделя 2', 1, 2],
  ]);
  assert.deepEqual(stats.byFormat.map((group) => [group.name, group.done, group.planned]), [
    ['reels', 1, 1],
    ['post', 1, 2],
  ]);
  assert.deepEqual(stats.byPillar.map((group) => group.name), ['До и после', 'Процесс']);
  assert.equal(stats.planFinished, true);
  assert.equal(stats.daysLeft, 0);
});

test('keeps weekly reviews and earlier audits for the comparison', () => {
  const stats = buildReviewStats(
    exported([item('a', '2026-10-02')], {
      reviews: [{ weekFrom: '2026-10-01', answers: { inquiries: 3, bestIdea: 'Кейс', hard: 'Съёмка' }, result: { headline: 'Ок' }, applied: true }],
      audit: [{ createdAt: '2026-10-01', result: { summary: 'Профиль слабый' } }],
      kits: { a: {} },
    }),
    '2026-10-31',
  );

  assert.equal(stats.weeklyReviews[0].inquiries, 3);
  assert.equal(stats.audits[0].summary, 'Профиль слабый');
  assert.equal(stats.kitsReady, 1);
  const text = describeReviewStats(stats);
  assert.match(text, /обращений 3/);
  assert.match(text, /Прежние разборы страницы: 2026-10-01/);
});

test('accepts a single stored audit object', () => {
  const stats = buildReviewStats(exported([item('a', '2026-10-02')], { audit: { createdAt: '2026-10-01', result: { summary: 'Ок' } } }), '2026-10-31');

  assert.equal(stats.audits.length, 1);
});

test('hands earlier monthly reviews over for the comparison', () => {
  const stats = buildReviewStats(
    exported([item('a', '2026-10-02')], { monthReviews: [{ id: 'm1', headline: 'Выполнено 12 из 16' }] }),
    '2026-10-31',
  );

  assert.equal(stats.monthReviews[0].headline, 'Выполнено 12 из 16');
  assert.deepEqual(buildReviewStats(exported([item('a', '2026-10-02')]), '2026-10-31').monthReviews, []);
});

test('lists the recommendations with the marks and the importance', () => {
  const stats = buildReviewStats(
    exported([item('a', '2026-10-02')], {
      recommendations: [
        { id: 'r1', text: 'Добавить запись в шапку', importance: 90, done: true },
        { id: 'r2', text: 'Обновить аватар', importance: 40, done: false },
      ],
    }),
    '2026-10-31',
  );

  assert.equal(stats.recommendations.length, 2);
  const text = describeReviewStats(stats);
  assert.match(text, /Рекомендации по профилю: сделано 1 из 2/);
  assert.match(text, /\[x\] 90% Добавить запись в шапку/);
  assert.match(text, /\[ \] 40% Обновить аватар/);
  assert.match(describeReviewStats(buildReviewStats(exported([item('a', '2026-10-02')]), '2026-10-31')), /Рекомендаций по профилю пока нет/);
});
