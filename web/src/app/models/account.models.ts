export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AccountInfo {
  name: string;
  retentionDays: number;
  providers?: string[];
}

export type SyncKey =
  | 'strategy'
  | 'calendar'
  | 'kits'
  | 'monthReviews'
  | 'recommendations'
  | 'shootProgress'
  | 'settings';

export type SyncBundle = Partial<Record<SyncKey, JsonValue>>;

export interface ServerState {
  version: number;
  data?: SyncBundle;
  updatedAt: string;
}

export interface SyncMeta {
  version: number;
  dirty: boolean;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error';
