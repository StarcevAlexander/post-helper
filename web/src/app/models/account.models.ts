export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AccountRole = 'admin' | 'master';

export interface AccountInfo {
  role: AccountRole;
  name: string;
  dailyLimit: number;
  usageToday: number;
}

export interface MasterSummary {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  disabled: boolean;
  usageToday: number;
  usageTotal: number;
}

export interface CreatedMaster {
  master: { id: string; name: string };
  code: string;
}

export type SyncKey = 'onboarding' | 'strategy' | 'calendar' | 'kits' | 'reviews' | 'audit';

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
