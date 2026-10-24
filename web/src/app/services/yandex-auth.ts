import { Service, computed, inject, signal } from '@angular/core';
import {
  OAUTH_STATE_BYTES,
  OAUTH_STATE_STORAGE_KEY,
  YANDEX_AUTHORIZE_URL,
  YANDEX_CLIENT_ID_STORAGE_KEY,
  YANDEX_PROVIDER,
  YANDEX_TEXTS,
} from '../constants';
import { ChatApiError, OAuthMode, OAuthPending } from '../models';
import { Access } from './access';
import { Account } from './account';
import { ChatApi } from './chat-api';
import { PAGE_NAVIGATE } from './page-navigate';

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(OAUTH_STATE_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

@Service()
export class YandexAuth {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly account = inject(Account);
  private readonly navigate = inject(PAGE_NAVIGATE);

  readonly clientId = signal(this.readCachedClientId());
  readonly available = computed(() => this.clientId() !== '');
  readonly linked = computed(() => this.account.info()?.providers?.includes(YANDEX_PROVIDER));
  readonly busy = signal(false);
  readonly notice = signal('');

  async loadConfig(): Promise<void> {
    try {
      const clientId = (await this.api.authConfig()).yandexClientId;
      this.clientId.set(clientId);
      this.cacheClientId(clientId);
    } catch {
      return;
    }
  }

  begin(mode: OAuthMode): void {
    if (!this.available() || this.busy()) {
      return;
    }
    const pending: OAuthPending = { state: randomState(), mode };
    try {
      localStorage.setItem(OAUTH_STATE_STORAGE_KEY, JSON.stringify(pending));
    } catch {
      this.notice.set(YANDEX_TEXTS.failed);
      return;
    }
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      state: pending.state,
    });
    this.navigate(`${YANDEX_AUTHORIZE_URL}?${query.toString()}`);
  }

  async completeFromUrl(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const refused = params.get('error');
    if (!state || (!code && !refused)) {
      return;
    }
    const pending = this.readPending();
    if (!pending || pending.state !== state) {
      return;
    }
    this.forgetPending();
    this.stripCallbackFromUrl(params);

    if (!code) {
      this.notice.set(YANDEX_TEXTS.denied);
      return;
    }
    this.busy.set(true);
    this.notice.set(YANDEX_TEXTS.working);
    try {
      if (pending.mode === 'login') {
        const session = await this.api.signInWithYandex(code, this.redirectUri());
        this.access.save(session.token);
        this.notice.set('');
      } else {
        await this.api.linkYandex(code, this.redirectUri());
        await this.account.refresh();
        this.notice.set(YANDEX_TEXTS.linkedDone);
      }
    } catch (error) {
      this.notice.set(error instanceof ChatApiError ? error.message : YANDEX_TEXTS.failed);
    } finally {
      this.busy.set(false);
    }
  }

  private readCachedClientId(): string {
    try {
      return localStorage.getItem(YANDEX_CLIENT_ID_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private cacheClientId(clientId: string): void {
    try {
      if (clientId) {
        localStorage.setItem(YANDEX_CLIENT_ID_STORAGE_KEY, clientId);
      } else {
        localStorage.removeItem(YANDEX_CLIENT_ID_STORAGE_KEY);
      }
    } catch {
      return;
    }
  }

  private redirectUri(): string {
    return document.baseURI.split(/[?#]/)[0];
  }

  private readPending(): OAuthPending | undefined {
    try {
      const raw = localStorage.getItem(OAUTH_STATE_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (typeof parsed === 'object' && parsed !== null) {
        const candidate = parsed as Record<string, unknown>;
        if (
          typeof candidate['state'] === 'string' &&
          (candidate['mode'] === 'login' || candidate['mode'] === 'link')
        ) {
          return { state: candidate['state'], mode: candidate['mode'] };
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private forgetPending(): void {
    try {
      localStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private stripCallbackFromUrl(params: URLSearchParams): void {
    ['code', 'state', 'error', 'error_description'].forEach((key) => params.delete(key));
    const query = params.toString();
    const clean = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', clean);
  }
}
