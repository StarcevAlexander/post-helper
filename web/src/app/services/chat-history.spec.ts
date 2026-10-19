import { TestBed } from '@angular/core/testing';
import { CHAT_HISTORY_STORAGE_KEY, MAX_STORED_MESSAGES } from '../constants';
import { ChatMessage } from '../models';
import { ChatHistory } from './chat-history';

function message(index: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `id-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `текст ${index}`,
    attachments: [],
    createdAt: new Date(2026, 9, 15, 12, index),
    ...overrides,
  };
}

describe('ChatHistory', () => {
  let history: ChatHistory;

  beforeEach(() => {
    localStorage.clear();
    history = TestBed.inject(ChatHistory);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns an empty list when nothing is stored', () => {
    expect(history.load()).toEqual([]);
  });

  it('round-trips finished messages with their dates', () => {
    history.save([message(0), message(1)]);

    const loaded = history.load();
    expect(loaded.map((item) => item.text)).toEqual(['текст 0', 'текст 1']);
    expect(loaded[0].createdAt.getTime()).toBe(message(0).createdAt.getTime());
    expect(loaded[0].attachments).toEqual([]);
  });

  it('does not store pending, failed or empty messages', () => {
    history.save([
      message(0),
      message(1, { pending: true, text: '' }),
      message(2, { failed: true }),
      message(3, { text: '   ' }),
    ]);

    expect(history.load().map((item) => item.id)).toEqual(['id-0']);
  });

  it('keeps only the newest messages', () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 5 }, (_, index) => message(index));
    history.save(many);

    const loaded = history.load();
    expect(loaded.length).toBe(MAX_STORED_MESSAGES);
    expect(loaded[loaded.length - 1].id).toBe(`id-${MAX_STORED_MESSAGES + 4}`);
  });

  it('ignores corrupted storage', () => {
    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, '{not json');
    expect(history.load()).toEqual([]);

    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify({ not: 'a list' }));
    expect(history.load()).toEqual([]);
  });

  it('skips malformed entries but keeps valid ones', () => {
    localStorage.setItem(
      CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { id: 'a', role: 'user', text: 'ok', createdAt: '2026-10-15T10:00:00.000Z' },
        { id: 'b', role: 'robot', text: 'bad role', createdAt: '2026-10-15T10:00:00.000Z' },
        { id: 'c', role: 'user', text: 'bad date', createdAt: 'not a date' },
        null,
      ]),
    );

    expect(history.load().map((item) => item.id)).toEqual(['a']);
  });
});
