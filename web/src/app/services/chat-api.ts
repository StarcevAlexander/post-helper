import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Service, inject, isDevMode } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  API_CHAT_PATH,
  API_CLIENT_ERROR_PATH,
  API_DEV_URL,
  API_KIT_PATH,
  API_MESSAGES,
  API_PRODUCTION_URL,
  API_STRATEGY_PATH,
  HTTP_OFFLINE,
  HTTP_UNAUTHORIZED,
  HTTP_UNPROCESSABLE,
  REQUEST_DESCRIPTIONS,
} from '../constants';
import {
  ApiErrorBody,
  ApiReply,
  ApiTurn,
  ChatApiError,
  ClientErrorReport,
  ComposerPayload,
  KitRequest,
  MasterProfile,
  PublicationKit,
  RequestDescriptor,
  Strategy,
} from '../models';
import { Access } from './access';
import { Conversation } from './conversation';
import { RequestLog } from './request-log';

@Service()
export class ChatApi {
  private readonly http = inject(HttpClient);
  private readonly access = inject(Access);
  private readonly conversation = inject(Conversation);
  private readonly requestLog = inject(RequestLog);

  async reportClientError(report: ClientErrorReport): Promise<void> {
    if (!this.access.granted()) {
      return;
    }
    try {
      await this.send<unknown>('POST', API_CLIENT_ERROR_PATH, report);
    } catch {
      return;
    }
  }

  async ask(payload: ComposerPayload, history: ApiTurn[]): Promise<string> {
    const body = new FormData();
    body.append('text', payload.text);
    body.append('history', JSON.stringify(history));
    body.append('conversation', this.conversation.id());
    for (const attachment of payload.attachments) {
      body.append('files', attachment.file, attachment.name);
    }

    const files = payload.attachments.length;
    const sent = [
      payload.text,
      files > 0 ? `Вложений: ${files}` : '',
      `Сообщений в контексте: ${history.length}`,
    ]
      .filter(Boolean)
      .join('\n');
    const response = await this.send<ApiReply>('POST', API_CHAT_PATH, body, {
      description: REQUEST_DESCRIPTIONS.chat,
      sent,
    });
    return response.reply;
  }

  requestStrategy(profile: MasterProfile): Promise<Strategy> {
    return this.send<Strategy>('POST', API_STRATEGY_PATH, profile, {
      description: REQUEST_DESCRIPTIONS.strategy,
      sent: [profile.specialty, profile.city].filter(Boolean).join(', '),
    });
  }

  requestKit(request: KitRequest): Promise<PublicationKit> {
    return this.send<PublicationKit>('POST', API_KIT_PATH, request, {
      description: REQUEST_DESCRIPTIONS.kit,
      sent: `${request.format}: ${request.idea}`,
    });
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: FormData | object,
    descriptor?: RequestDescriptor,
  ): Promise<T> {
    const logId = descriptor ? this.requestLog.start(descriptor) : undefined;
    const baseUrl = isDevMode() ? API_DEV_URL : API_PRODUCTION_URL;
    if (!baseUrl) {
      const failure = new ChatApiError(API_MESSAGES.notConfigured);
      this.finishLog(logId, 'error', failure.message);
      throw failure;
    }

    try {
      const response = await firstValueFrom(
        this.http.request<T>(method, `${baseUrl}${path}`, {
          body,
          headers: new HttpHeaders({ Authorization: `Bearer ${this.access.password()}` }),
        }),
      );
      this.finishLog(
        logId,
        'success',
        typeof response === 'string' ? response : JSON.stringify(response),
      );
      return response;
    } catch (error) {
      const failure = this.toApiError(error);
      this.finishLog(logId, 'error', failure.message);
      throw failure;
    }
  }

  private finishLog(id: string | undefined, status: 'success' | 'error', received: string): void {
    if (id) {
      this.requestLog.finish(id, status, received);
    }
  }

  private toApiError(error: unknown): ChatApiError {
    if (!(error instanceof HttpErrorResponse)) {
      return new ChatApiError(API_MESSAGES.failed);
    }
    if (error.status === HTTP_UNAUTHORIZED) {
      return new ChatApiError(API_MESSAGES.unauthorized, true);
    }
    if (error.status === HTTP_OFFLINE) {
      return new ChatApiError(API_MESSAGES.offline);
    }
    const serverMessage = (error.error as ApiErrorBody | null)?.error;
    return new ChatApiError(
      serverMessage || API_MESSAGES.failed,
      false,
      error.status === HTTP_UNPROCESSABLE,
    );
  }
}
