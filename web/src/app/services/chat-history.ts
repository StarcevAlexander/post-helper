import { Service } from '@angular/core';
import { CHAT_HISTORY_STORAGE_KEY, MAX_STORED_MESSAGES, ONBOARDING_STEPS } from '../constants';
import { ChatMessage, MessageRole, ProfileField, StoredMessage } from '../models';

const ROLES: readonly MessageRole[] = ['user', 'assistant'];

function isStoredMessage(value: unknown): value is StoredMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['text'] === 'string' &&
    typeof candidate['createdAt'] === 'string' &&
    !Number.isNaN(Date.parse(candidate['createdAt'])) &&
    ROLES.includes(candidate['role'] as MessageRole) &&
    (candidate['onboarding'] === undefined || typeof candidate['onboarding'] === 'boolean') &&
    (candidate['answerFor'] === undefined ||
      ONBOARDING_STEPS.some((step) => step.field === (candidate['answerFor'] as ProfileField)))
  );
}

@Service()
export class ChatHistory {
  load(): ChatMessage[] {
    try {
      const raw = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isStoredMessage).map((stored) => ({
        id: stored.id,
        role: stored.role,
        text: stored.text,
        attachments: [],
        createdAt: new Date(stored.createdAt),
        onboarding: stored.onboarding,
        answerFor: stored.answerFor,
      }));
    } catch {
      return [];
    }
  }

  save(messages: ChatMessage[]): void {
    const stored: StoredMessage[] = messages
      .filter((message) => !message.pending && !message.failed && message.text.trim().length > 0)
      .slice(-MAX_STORED_MESSAGES)
      .map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        onboarding: message.onboarding,
        answerFor: message.answerFor,
      }));
    try {
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      return;
    }
  }
}
