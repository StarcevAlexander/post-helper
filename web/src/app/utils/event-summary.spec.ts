import { MasterEvent } from '../models';
import { eventLabel, summarizeEvent } from './event-summary';
import { formatRetention } from './format-retention';

function event(kind: string, payload: MasterEvent['payload']): MasterEvent {
  return { id: 1, kind, payload, createdAt: '2026-10-19T09:00:00Z' };
}

describe('summarizeEvent', () => {
  it('shows what the master asked in the chat', () => {
    expect(summarizeEvent(event('chat', { text: 'как привлечь клиентов', reply: 'ответ' }))).toBe(
      'как привлечь клиентов',
    );
  });

  it('shortens a very long question', () => {
    const summary = summarizeEvent(event('chat', { text: 'слово '.repeat(100) }));

    expect(Array.from(summary).length).toBeLessThanOrEqual(120);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('names the format and the idea of a kit', () => {
    expect(
      summarizeEvent(
        event('kit', { request: { format: 'reels', idea: 'Видео снятия гель-лака' } }),
      ),
    ).toBe('reels: Видео снятия гель-лака');
  });

  it('counts the done publications of a review', () => {
    const items = [{ done: true }, { done: false }, { done: true }];

    expect(summarizeEvent(event('review', { request: { items } }))).toBe('Выполнено 2 из 3');
  });

  it('counts the screenshots of an audit', () => {
    expect(summarizeEvent(event('audit', { images: ['a.png', 'b.png'] }))).toBe('Скриншотов: 2');
  });

  it('shows the verdict of a strategy and the move of a restore', () => {
    expect(summarizeEvent(event('strategy', { strategy: { summary: 'Вы мастер маникюра' } }))).toBe(
      'Вы мастер маникюра',
    );
    expect(summarizeEvent(event('admin.restore', { fromVersion: 2, newVersion: 5 }))).toBe(
      'версия 2 → 5',
    );
  });

  it('returns nothing for a payload it does not know', () => {
    expect(summarizeEvent(event('chat', 'text'))).toBe('');
    expect(summarizeEvent(event('mystery', { a: 1 }))).toBe('');
    expect(summarizeEvent(event('review', {}))).toBe('');
  });

  it('gives a Russian name to known kinds and keeps the unknown one', () => {
    expect(eventLabel('review')).toBe('Итоги недели');
    expect(eventLabel('mystery')).toBe('mystery');
  });
});

describe('formatRetention', () => {
  it.each([
    [1095, '3 года'],
    [365, '1 год'],
    [1825, '5 лет'],
    [4015, '11 лет'],
    [200, '200 дн.'],
    [0, 'без ограничения срока'],
  ])('writes %i days as %s', (days, expected) => {
    expect(formatRetention(days)).toBe(expected);
  });
});
