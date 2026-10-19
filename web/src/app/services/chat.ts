import { Service, computed, effect, inject, signal } from '@angular/core';
import { MAX_HISTORY_TURNS, WELCOME_TEXT } from '../constants';
import {
  ApiTurn,
  Attachment,
  ChatApiError,
  ChatMessage,
  ChatReply,
  ComposerPayload,
} from '../models';
import { Access } from './access';
import { ChatApi } from './chat-api';
import { ChatHistory } from './chat-history';
import { Conversation } from './conversation';
import { ErrorLog } from './error-log';

@Service()
export class Chat {
  private readonly api = inject(ChatApi);
  private readonly conversation = inject(Conversation);
  private readonly access = inject(Access);
  private readonly history = inject(ChatHistory);
  private readonly errorLog = inject(ErrorLog);

  readonly messages = signal<ChatMessage[]>(this.restoreMessages());
  readonly busy = signal(false);
  readonly lastReply = signal<ChatReply | undefined>(undefined);
  readonly contextCount = computed(() =>
    Math.min(this.contextTurns(this.messages()).length, MAX_HISTORY_TURNS),
  );
  readonly contextTotal = computed(() => this.contextTurns(this.messages()).length);
  readonly retryableIds = computed(() => {
    const messages = this.messages();
    const ids = new Set<string>();
    messages.forEach((message, index) => {
      const reply = messages[index + 1];
      if (message.role === 'user' && reply?.role === 'assistant' && reply.failed) {
        ids.add(message.id);
      }
    });
    return ids;
  });

  constructor() {
    effect(() => this.history.save(this.messages()));
  }

  clear(): void {
    if (this.busy()) {
      return;
    }
    this.messages().forEach((message) => this.revokePreviews(message));
    this.messages.set([this.createWelcomeMessage()]);
    this.conversation.reset();
  }

  send(payload: ComposerPayload): void {
    const text = payload.text.trim();
    if (this.busy() || (!text && payload.attachments.length === 0)) {
      return;
    }

    const history = this.buildHistory();
    const pendingId = this.appendExchange(text, payload.attachments);
    void this.requestReply(pendingId, { text, attachments: payload.attachments }, history);
  }

  retry(id: string): void {
    const messages = this.messages();
    const index = messages.findIndex((message) => message.id === id);
    const request = messages[index];
    const reply = messages[index + 1];
    if (this.busy() || !this.retryableIds().has(id) || !request || !reply) {
      return;
    }

    const history = this.contextTurns(messages.slice(0, index)).slice(-MAX_HISTORY_TURNS);
    this.updateMessage(reply.id, { text: '', pending: true, failed: false });
    this.busy.set(true);
    void this.requestReply(
      reply.id,
      { text: request.text, attachments: request.attachments },
      history,
    );
  }

  remove(id: string): void {
    const target = this.messages().find((message) => message.id === id);
    if (!target || target.pending) {
      return;
    }
    this.revokePreviews(target);
    this.messages.update((messages) => messages.filter((message) => message.id !== id));
  }

  private appendExchange(text: string, attachments: Attachment[]): string {
    const pendingId = crypto.randomUUID();
    this.messages.update((messages) => [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        attachments,
        createdAt: new Date(),
      },
      {
        id: pendingId,
        role: 'assistant',
        text: '',
        attachments: [],
        createdAt: new Date(),
        pending: true,
      },
    ]);
    this.busy.set(true);
    return pendingId;
  }

  private async requestReply(
    pendingId: string,
    payload: ComposerPayload,
    history: ApiTurn[],
  ): Promise<void> {
    try {
      const reply = await this.api.ask(payload, history);
      this.updateMessage(pendingId, { text: reply, pending: false, failed: false });
      this.lastReply.set({ id: pendingId, text: reply });
    } catch (error) {
      this.failPending(pendingId, error);
    }
  }

  private failPending(id: string, error: unknown): void {
    if (error instanceof ChatApiError && error.unauthorized) {
      this.access.clear();
    }
    const message = error instanceof ChatApiError ? error.message : String(error);
    this.errorLog.record('send', message);
    this.updateMessage(id, { text: message, pending: false, failed: true });
  }

  private updateMessage(id: string, patch: Partial<ChatMessage>): void {
    this.messages.update((messages) =>
      messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
    if (patch.pending === false) {
      this.busy.set(false);
    }
  }

  private restoreMessages(): ChatMessage[] {
    const restored = this.history.load();
    const ordered = [...restored].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return ordered.length > 0 ? ordered : [this.createWelcomeMessage()];
  }

  private createWelcomeMessage(): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: WELCOME_TEXT,
      attachments: [],
      createdAt: new Date(),
    };
  }

  private revokePreviews(message: ChatMessage): void {
    message.attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
  }

  private contextTurns(messages: ChatMessage[]): ApiTurn[] {
    return messages
      .filter((message) => !message.pending && !message.failed && message.text.trim().length > 0)
      .map((message) => ({ role: message.role, text: message.text.trim() }));
  }

  private buildHistory(): ApiTurn[] {
    return this.contextTurns(this.messages()).slice(-MAX_HISTORY_TURNS);
  }
}
