import { PostFormat } from './schedule.models';

export type RefKind = 'photo';

export type RefState = 'queued' | 'running' | 'done' | 'failed' | 'made';

export interface RefFileMeta {
  id: string;
  index: number;
  kind: RefKind;
  mediaType: string;
  caption: string;
  size: number;
}

export interface RefStatus {
  key: string;
  status: RefState;
  kind: RefKind;
  date?: string;
  stale: boolean;
  error?: string;
  files: RefFileMeta[];
}

export type RefTileLoad =
  { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed' };

export interface RefTileView {
  file: RefFileMeta;
  load: RefTileLoad;
}

export interface RefOrderItem {
  key: string;
  format: PostFormat;
  pillar: string;
  idea: string;
  date: string;
}
