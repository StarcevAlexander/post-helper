import { HttpClient, HttpErrorResponse, HttpEvent, HttpHeaders } from '@angular/common/http';
import { Service, inject, isDevMode } from '@angular/core';
import { Observable, catchError, firstValueFrom, throwError } from 'rxjs';
import {
  API_CLIENT_ERROR_PATH,
  API_FEEDBACK_PATH,
  API_INTAKE_PATH,
  API_MEDIA_FILES_PATH,
  API_MEDIA_ITEMS_PATH,
  API_MEDIA_REDO_SUFFIX,
  API_MEDIA_STATUS_PATH,
  API_MEDIA_UPLOAD_PATH,
  API_NOTICES_PATH,
  API_PUSH_KEY_PATH,
  API_PUSH_SUBSCRIBE_PATH,
  API_PUSH_UNSUBSCRIBE_PATH,
  API_REFS_FILES_PATH,
  API_REFS_MADE_PATH,
  API_REFS_ORDER_PATH,
  API_REFS_STATUS_PATH,
  API_DEV_URL,
  API_MESSAGES,
  API_AUTH_CONFIG_PATH,
  API_AUTH_YANDEX_PATH,
  API_ME_NAME_PATH,
  API_ME_PATH,
  API_ME_YANDEX_PATH,
  API_PRODUCTION_URL,
  API_STATE_PATH,
  HTTP_CONFLICT,
  HTTP_OFFLINE,
  HTTP_UNAUTHORIZED,
  HTTP_UNPROCESSABLE,
} from '../constants';
import {
  AccountInfo,
  AuthConfig,
  ProvidersResult,
  SessionResult,
  RefOrderItem,
  RefStatus,
  ApiErrorBody,
  ApiError,
  ClientErrorReport,
  FeedbackSubmission,
  IntakeSubmission,
  IntakeRequest,
  MediaStatus,
  NoticeView,
  PushKeyResponse,
  PushSubscriptionPayload,
  ServerState,
  StateConflictError,
  SyncBundle,
} from '../models';
import { Access } from './access';

@Service()
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly access = inject(Access);

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

  sendFeedback(submission: FeedbackSubmission): Promise<void> {
    return this.send<void>('POST', API_FEEDBACK_PATH, submission);
  }

  submitIntake(draft: IntakeSubmission): Promise<IntakeRequest> {
    return this.send<IntakeRequest>('POST', API_INTAKE_PATH, draft);
  }

  async latestIntake(): Promise<IntakeRequest | undefined> {
    const request = await this.send<IntakeRequest | null>('GET', API_INTAKE_PATH);
    return request ?? undefined;
  }

  async pushPublicKey(): Promise<string> {
    const response = await this.send<PushKeyResponse>('GET', API_PUSH_KEY_PATH);
    return response.publicKey;
  }

  async subscribePush(subscription: PushSubscriptionPayload): Promise<void> {
    await this.send<null>('POST', API_PUSH_SUBSCRIBE_PATH, subscription);
  }

  async unsubscribePush(endpoint: string): Promise<void> {
    await this.send<null>('POST', API_PUSH_UNSUBSCRIBE_PATH, { endpoint });
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

  refFile(id: string): Promise<Blob> {
    return this.fetchBlob(`${API_REFS_FILES_PATH}/${encodeURIComponent(id)}`);
  }

  uploadMedia(form: FormData): Observable<HttpEvent<MediaStatus>> {
    const baseUrl = isDevMode() ? API_DEV_URL : API_PRODUCTION_URL;
    if (!baseUrl) {
      return throwError(() => new ApiError(API_MESSAGES.notConfigured));
    }
    return this.http
      .request<MediaStatus>('POST', `${baseUrl}${API_MEDIA_UPLOAD_PATH}`, {
        body: form,
        headers: new HttpHeaders({ Authorization: `Bearer ${this.access.password()}` }),
        reportProgress: true,
        observe: 'events',
      })
      .pipe(catchError((error: unknown) => throwError(() => this.toApiError(error))));
  }

  mediaStatuses(): Promise<MediaStatus[]> {
    return this.send<MediaStatus[]>('GET', API_MEDIA_STATUS_PATH);
  }

  mediaFile(id: string): Promise<Blob> {
    return this.fetchBlob(`${API_MEDIA_FILES_PATH}/${encodeURIComponent(id)}`);
  }

  mediaThumb(id: string): Promise<Blob> {
    return this.fetchBlob(`${API_MEDIA_FILES_PATH}/${encodeURIComponent(id)}/thumb`);
  }

  redoMedia(id: string, wish: string): Promise<MediaStatus> {
    return this.send<MediaStatus>(
      'POST',
      `${API_MEDIA_ITEMS_PATH}/${encodeURIComponent(id)}${API_MEDIA_REDO_SUFFIX}`,
      { wish },
    );
  }

  async deleteMedia(id: string): Promise<void> {
    await this.send<{ ok: boolean }>('DELETE', `${API_MEDIA_ITEMS_PATH}/${encodeURIComponent(id)}`);
  }

  notices(): Promise<NoticeView[]> {
    return this.send<NoticeView[]>('GET', API_NOTICES_PATH);
  }

  notice(id: string): Promise<NoticeView> {
    return this.send<NoticeView>('GET', `${API_NOTICES_PATH}/${encodeURIComponent(id)}`);
  }

  me(): Promise<AccountInfo> {
    return this.send<AccountInfo>('GET', API_ME_PATH);
  }

  rename(name: string): Promise<{ name: string }> {
    return this.send<{ name: string }>('POST', API_ME_NAME_PATH, { name });
  }

  authConfig(): Promise<AuthConfig> {
    return this.send<AuthConfig>('GET', API_AUTH_CONFIG_PATH);
  }

  signInWithYandex(code: string, redirectUri: string): Promise<SessionResult> {
    return this.send<SessionResult>('POST', API_AUTH_YANDEX_PATH, { code, redirectUri });
  }

  linkYandex(code: string, redirectUri: string): Promise<ProvidersResult> {
    return this.send<ProvidersResult>('POST', API_ME_YANDEX_PATH, { code, redirectUri });
  }

  loadState(): Promise<ServerState> {
    return this.send<ServerState>('GET', API_STATE_PATH);
  }

  saveState(baseVersion: number, data: SyncBundle): Promise<ServerState> {
    return this.send<ServerState>('PUT', API_STATE_PATH, { baseVersion, data });
  }

  private async fetchBlob(path: string): Promise<Blob> {
    const baseUrl = isDevMode() ? API_DEV_URL : API_PRODUCTION_URL;
    if (!baseUrl) {
      throw new ApiError(API_MESSAGES.notConfigured);
    }
    try {
      return await firstValueFrom(
        this.http.get(`${baseUrl}${path}`, {
          responseType: 'blob',
          headers: new HttpHeaders({ Authorization: `Bearer ${this.access.password()}` }),
        }),
      );
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  private async send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: FormData | object,
  ): Promise<T> {
    const baseUrl = isDevMode() ? API_DEV_URL : API_PRODUCTION_URL;
    if (!baseUrl) {
      throw new ApiError(API_MESSAGES.notConfigured);
    }

    try {
      return await firstValueFrom(
        this.http.request<T>(method, `${baseUrl}${path}`, {
          body,
          headers: new HttpHeaders({ Authorization: `Bearer ${this.access.password()}` }),
        }),
      );
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  private toApiError(error: unknown): ApiError {
    if (!(error instanceof HttpErrorResponse)) {
      return new ApiError(API_MESSAGES.failed);
    }
    if (error.status === HTTP_UNAUTHORIZED) {
      return new ApiError(API_MESSAGES.unauthorized, true);
    }
    if (error.status === HTTP_OFFLINE) {
      return new ApiError(API_MESSAGES.offline);
    }
    const body = error.error as ApiErrorBody | null;
    if (error.status === HTTP_CONFLICT && body?.state) {
      return new StateConflictError(body.error ?? API_MESSAGES.failed, body.state);
    }
    const serverMessage = body?.error;
    return new ApiError(
      serverMessage || API_MESSAGES.failed,
      false,
      error.status === HTTP_UNPROCESSABLE,
    );
  }
}
