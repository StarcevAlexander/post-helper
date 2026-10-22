import { Service, computed, effect, inject, signal } from '@angular/core';
import {
  MAX_HISTORY_TURNS,
  BACK_WORDS,
  ONBOARDING_EDIT_TEXT,
  ONBOARDING_BACK_TEXT,
  ONBOARDING_FIRST_QUESTION_BACK_TEXT,
  ONBOARDING_INTRO_TEXT,
  ONBOARDING_PREVIOUS_ANSWER_LABEL,
  ONBOARDING_REPEAT_TEXT,
  ONBOARDING_REVIEW_TEXT,
  ONBOARDING_REVIEWING_REMINDER_TEXT,
  STRATEGY_NO_PROFILE_TEXT,
  STRATEGY_READY_TEXT,
  WELCOME_TEXT,
} from '../constants';
import {
  ApiTurn,
  Attachment,
  ChatApiError,
  ChatMessage,
  ChatReply,
  ComposerPayload,
  ProfileField,
} from '../models';
import { Access } from './access';
import { Audit } from './audit';
import { AuditJobs } from './audit-jobs';
import { CalendarPlan } from './calendar-plan';
import { ChatApi } from './chat-api';
import { ChatHistory } from './chat-history';
import { Conversation } from './conversation';
import { ErrorLog } from './error-log';
import { Onboarding } from './onboarding';

@Service()
export class Chat {
  private readonly api = inject(ChatApi);
  private readonly conversation = inject(Conversation);
  private readonly access = inject(Access);
  private readonly history = inject(ChatHistory);
  private readonly errorLog = inject(ErrorLog);
  private readonly onboarding = inject(Onboarding);
  private readonly calendarPlan = inject(CalendarPlan);
  private readonly audit = inject(Audit);
  private readonly auditJobs = inject(AuditJobs);
  private strategyReplyId?: string;

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
    this.messages.set(this.createWelcomeMessages());
    this.conversation.reset();
  }

  send(payload: ComposerPayload): void {
    const text = payload.text.trim();
    if (this.busy() || (!text && payload.attachments.length === 0)) {
      return;
    }

    if (this.onboarding.active() || this.onboarding.reviewing()) {
      this.answerOnboarding(text, payload.attachments);
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

    this.updateMessage(reply.id, { text: '', pending: true, failed: false });
    this.busy.set(true);
    if (reply.id === this.strategyReplyId) {
      void this.requestStrategy(reply.id);
      return;
    }

    const history = this.contextTurns(messages.slice(0, index)).slice(-MAX_HISTORY_TURNS);
    void this.requestReply(
      reply.id,
      { text: request.text, attachments: request.attachments },
      history,
    );
  }

  buildStrategy(): void {
    if (this.busy() || !this.onboarding.profile()) {
      return;
    }
    const instagram = this.onboarding.answers().instagram;
    if (instagram) {
      void this.auditJobs.autoOrder(instagram);
    }
    const pendingId = this.appendPending();
    void this.requestStrategy(pendingId);
  }

  restartOnboarding(): void {
    if (this.busy()) {
      return;
    }
    this.messages().forEach((message) => this.revokePreviews(message));
    this.onboarding.reset();
    this.onboarding.start();
    this.calendarPlan.reset();
    this.audit.reset();
    this.messages.set(this.createWelcomeMessages());
    this.conversation.reset();
  }

  editAnswer(id: string): void {
    const target = this.messages().find((message) => message.id === id);
    if (this.busy() || !target?.answerFor || !this.onboarding.startEdit(target.answerFor)) {
      return;
    }
    const previous = this.onboarding.currentAnswer();
    const note = previous
      ? `${ONBOARDING_EDIT_TEXT} ${ONBOARDING_PREVIOUS_ANSWER_LABEL}: «${previous}».`
      : ONBOARDING_EDIT_TEXT;
    this.appendAssistantText(note);
    this.appendAssistantText(this.questionText());
  }

  remove(id: string): void {
    const target = this.messages().find((message) => message.id === id);
    if (!target || target.pending || target.onboarding || target.answerFor) {
      return;
    }
    this.revokePreviews(target);
    this.messages.update((messages) => messages.filter((message) => message.id !== id));
  }

  private appendExchange(text: string, attachments: Attachment[]): string {
    this.messages.update((messages) => [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        attachments,
        createdAt: new Date(),
      },
    ]);
    return this.appendPending();
  }

  private appendPending(): string {
    const pendingId = crypto.randomUUID();
    this.messages.update((messages) => [
      ...messages,
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

  private appendAssistantText(text: string): void {
    this.messages.update((messages) => [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        text,
        attachments: [],
        createdAt: new Date(),
        onboarding: true,
      },
    ]);
  }

  private answerOnboarding(text: string, attachments: Attachment[]): void {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    if (!text) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      attachments: [],
      createdAt: new Date(),
    };
    this.messages.update((messages) => [...messages, userMessage]);

    if (this.onboarding.reviewing()) {
      this.appendAssistantText(ONBOARDING_REVIEWING_REMINDER_TEXT);
      return;
    }
    if (BACK_WORDS.includes(text.toLowerCase())) {
      this.goBack();
      return;
    }

    const step = this.onboarding.step();
    const result = this.onboarding.answer(text);
    if (step && (result.outcome === 'next' || result.outcome === 'done')) {
      this.markAnswer(userMessage.id, step.field);
      if (step.field === 'instagram' && this.onboarding.answers().instagram) {
        void this.auditJobs.autoOrder(text);
      }
    }
    switch (result.outcome) {
      case 'repeat':
        this.appendAssistantText(ONBOARDING_REPEAT_TEXT);
        this.appendAssistantText(this.questionText());
        break;
      case 'invalid':
        this.appendAssistantText(result.reason ?? ONBOARDING_REPEAT_TEXT);
        break;
      case 'next':
        this.appendAssistantText(this.questionText());
        break;
      case 'done':
        this.appendAssistantText(ONBOARDING_REVIEW_TEXT);
        break;
    }
  }

  private markAnswer(messageId: string, field: ProfileField): void {
    this.messages.update((messages) =>
      messages.map((message) => {
        if (message.id === messageId) {
          return { ...message, answerFor: field };
        }
        return message.answerFor === field ? { ...message, answerFor: undefined } : message;
      }),
    );
  }

  private goBack(): void {
    if (!this.onboarding.back()) {
      this.appendAssistantText(ONBOARDING_FIRST_QUESTION_BACK_TEXT);
      return;
    }
    const previous = this.onboarding.currentAnswer();
    const note = previous ? ` ${ONBOARDING_PREVIOUS_ANSWER_LABEL}: «${previous}».` : '';
    this.appendAssistantText(`${ONBOARDING_BACK_TEXT}${note}`);
    this.appendAssistantText(this.questionText());
  }

  private questionText(): string {
    const step = this.onboarding.step();
    return step
      ? `${this.onboarding.index() + 1} из ${this.onboarding.total}. ${step.question}`
      : '';
  }

  private async requestStrategy(pendingId: string): Promise<void> {
    const profile = this.onboarding.profile();
    this.strategyReplyId = pendingId;
    if (!profile) {
      this.failPending(pendingId, new ChatApiError(STRATEGY_NO_PROFILE_TEXT));
      return;
    }
    try {
      const strategy = await this.api.requestStrategy(profile);
      this.onboarding.setStrategy(strategy);
      this.updateMessage(pendingId, { text: STRATEGY_READY_TEXT, pending: false, failed: false });
      this.strategyReplyId = undefined;
    } catch (error) {
      if (error instanceof ChatApiError && error.insufficient) {
        this.onboarding.reopenReview();
      }
      this.failPending(pendingId, error);
    }
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
    return ordered.length > 0 ? ordered : this.createWelcomeMessages();
  }

  private createWelcomeMessages(): ChatMessage[] {
    const welcome = (text: string): ChatMessage => ({
      id: crypto.randomUUID(),
      role: 'assistant',
      text,
      attachments: [],
      createdAt: new Date(),
      onboarding: this.onboarding.active(),
    });
    if (!this.onboarding.active()) {
      return [welcome(WELCOME_TEXT)];
    }
    const first = welcome(ONBOARDING_INTRO_TEXT);
    const question = welcome(this.questionText());
    return [first, { ...question, createdAt: new Date(first.createdAt.getTime() + 1) }];
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
