export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AccountRole = 'admin' | 'master';

export interface AccountInfo {
  role: AccountRole;
  name: string;
  dailyLimit: number;
  usageToday: number;
  retentionDays: number;
  providers?: string[];
}

export type SyncKey =
  'strategy' | 'calendar' | 'kits' | 'monthReviews' | 'recommendations' | 'settings';

export type SyncBundle = Partial<Record<SyncKey, JsonValue>>;

export interface ServerState {
  version: number;
  data: SyncBundle | null;
  updatedAt: string;
}

export interface SyncMeta {
  version: number;
  dirty: boolean;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error';
