import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Service, inject, isDevMode } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  API_CHAT_PATH,
  API_CLIENT_ERROR_PATH,
  API_AUDIT_JOBS_PATH,
  API_INTAKE_PATH,
  API_REFS_FILES_PATH,
  API_REFS_MADE_PATH,
  API_REFS_ORDER_PATH,
  API_REFS_STATUS_PATH,
  API_AUDIT_PATH,
  API_DEV_URL,
  API_KIT_PATH,
  API_ME_PATH,
  API_MESSAGES,
  API_PRODUCTION_URL,
  API_REVIEW_PATH,
  API_STATE_PATH,
  API_STRATEGY_PATH,
  HTTP_CONFLICT,
  HTTP_OFFLINE,
  HTTP_UNAUTHORIZED,
  HTTP_UNPROCESSABLE,
  REQUEST_DESCRIPTIONS,
} from '../constants';
import {
  AccountInfo,
  AuditJob,
  RefOrderItem,
  RefStatus,
  AuditResult,
  ApiErrorBody,
  ApiReply,
  ApiTurn,
  ChatApiError,
  ClientErrorReport,
  ComposerPayload,
  IntakeDraft,
  IntakeRequest,
  KitRequest,
  MasterProfile,
  PublicationKit,
  ReviewRequest,
  ReviewResult,
  ServerState,
  StateConflictError,
  SyncBundle,
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

  requestAudit(profile: MasterProfile, files: File[]): Promise<AuditResult> {
    const body = new FormData();
    body.append('profile', JSON.stringify(profile));
    for (const file of files) {
      body.append('images', file, file.name);
    }
    return this.send<AuditResult>('POST', API_AUDIT_PATH, body, {
      description: REQUEST_DESCRIPTIONS.audit,
      sent: `Скриншотов: ${files.length}`,
    });
  }

  createAuditJob(handle: string, consent: boolean): Promise<AuditJob> {
    return this.send<AuditJob>('POST', API_AUDIT_JOBS_PATH, { handle, consent });
  }

  async latestAuditJob(): Promise<AuditJob | undefined> {
    const job = await this.send<AuditJob | null>('GET', `${API_AUDIT_JOBS_PATH}/latest`);
    return job ?? undefined;
  }

  cancelAuditJob(id: string): Promise<{ canceled: boolean }> {
    return this.send<{ canceled: boolean }>(
      'POST',
      `${API_AUDIT_JOBS_PATH}/${encodeURIComponent(id)}/cancel`,
      {},
    );
  }

  submitIntake(draft: IntakeDraft): Promise<IntakeRequest> {
    return this.send<IntakeRequest>('POST', API_INTAKE_PATH, draft);
  }

  async latestIntake(): Promise<IntakeRequest | undefined> {
    const request = await this.send<IntakeRequest | null>('GET', API_INTAKE_PATH);
    return request ?? undefined;
  }

  orderRefs(items: RefOrderItem[]): Promise<{ added: number; removed: number }> {
    return this.send<{ added: number; removed: number }>('POST', API_REFS_ORDER_PATH, { items });
  }

  refStatuses(): Promise<RefStatus[]> {
    return this.send<RefStatus[]>('GET', API_REFS_STATUS_PATH);
  }

  confirmRefsMade(key: string): Promise<{ ok: boolean }> {
    return this.send<{ ok: boolean }>('POST', API_REFS_MADE_PATH, { key });
  }

  async refFile(id: string): Promise<Blob> {
    const baseUrl = isDevMode() ? API_DEV_URL : API_PRODUCTION_URL;
    if (!baseUrl) {
      throw new ChatApiError(API_MESSAGES.notConfigured);
    }
    try {
      return await firstValueFrom(
        this.http.get(`${baseUrl}${API_REFS_FILES_PATH}/${encodeURIComponent(id)}`, {
          responseType: 'blob',
          headers: new HttpHeaders({ Authorization: `Bearer ${this.access.password()}` }),
        }),
      );
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  me(): Promise<AccountInfo> {
    return this.send<AccountInfo>('GET', API_ME_PATH);
  }

  loadState(): Promise<ServerState> {
    return this.send<ServerState>('GET', API_STATE_PATH);
  }

  saveState(baseVersion: number, data: SyncBundle): Promise<ServerState> {
    return this.send<ServerState>('PUT', API_STATE_PATH, { baseVersion, data });
  }

  requestReview(request: ReviewRequest): Promise<ReviewResult> {
    return this.send<ReviewResult>('POST', API_REVIEW_PATH, request, {
      description: REQUEST_DESCRIPTIONS.review,
      sent: `${request.items.length}`,
    });
  }

  private async send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
    const body = error.error as ApiErrorBody | null;
    if (error.status === HTTP_CONFLICT && body?.state) {
      return new StateConflictError(body.error ?? API_MESSAGES.failed, body.state);
    }
    const serverMessage = body?.error;
    return new ChatApiError(
      serverMessage || API_MESSAGES.failed,
      false,
      error.status === HTTP_UNPROCESSABLE,
    );
  }
}
