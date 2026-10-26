import { PostFormat } from './schedule.models';

export type MediaKind = 'photo' | 'video';

export type MediaState = 'queued' | 'running' | 'done' | 'failed';

export type MediaFormat = PostFormat;

export interface MediaSource {
  name: string;
  type: string;
  size: number;
}

export interface MediaResult {
  type: string;
  size: number;
  width: number;
  height: number;
  durationMs: number;
  subtitled: boolean;
  thumb: boolean;
  note: string;
  caption?: string;
}

export interface MediaStatus {
  id: string;
  key: string;
  unit: string;
  kind: MediaKind;
  format: MediaFormat;
  status: MediaState;
  error: string;
  note?: string;
  createdAt: string;
  finishedAt?: string;
  source: MediaSource;
  result?: MediaResult;
  wish?: string;
  redos: number;
  canRedo: boolean;
}

export interface MediaUploadMeta {
  key: string;
  unit: string;
  format: MediaFormat;
  pillar: string;
  idea: string;
  overlay: string;
  note?: string;
}

export interface MediaUpload {
  id: string;
  key: string;
  unit: string;
  name: string;
  progress: number;
  error?: string;
}

export type MediaTileLoad =
  { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed' };

export type MediaTileState = 'uploading' | 'failed' | MediaState;

export interface MediaEntryView {
  id: string;
  state: MediaTileState;
  label: string;
  progress?: number;
  status?: MediaStatus;
  thumb: MediaTileLoad;
}

export interface MediaContentView {
  status: MediaStatus;
  label: string;
  fileName: string;
  ratio: string;
  media: MediaTileLoad;
  poster?: string;
}

export type MediaSaveResult = 'shared' | 'downloaded' | 'cancelled';
