export type OAuthMode = 'login' | 'link';

export interface OAuthPending {
  state: string;
  mode: OAuthMode;
}

export interface AuthConfig {
  yandexClientId: string;
}

export interface SessionResult {
  token: string;
  name: string;
}

export interface ProvidersResult {
  providers: string[];
}
