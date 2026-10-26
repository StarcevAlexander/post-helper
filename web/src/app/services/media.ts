import { HttpEventType } from '@angular/common/http';
import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { lastValueFrom, tap } from 'rxjs';
import {
  MEDIA_FILE_EXTENSIONS,
  MEDIA_KIND_EXTENSIONS,
  MEDIA_COPY_MAX_BYTES,
  MEDIA_MAX_BYTES,
  MEDIA_NOTE_MAX_LENGTH,
  MEDIA_NOTES_STORAGE_KEY,
  MEDIA_POLL_MS,
  MEDIA_TEXTS,
} from '../constants';
import { MediaSaveResult, MediaStatus, MediaUpload, MediaUploadMeta, PlanItem } from '../models';
import { Account } from './account';
import { ApiClient } from './api-client';
import { ClientErrors } from './client-errors';

function isPending(status: MediaStatus): boolean {
  return status.status === 'queued' || status.status === 'running';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

@Service()
export class Media {
  private readonly api = inject(ApiClient);
  private readonly clientErrors = inject(ClientErrors);
  private readonly account = inject(Account);
  private readonly blobs = new Map<string, Promise<Blob>>();
  private readonly urls = new Map<string, Promise<string>>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private uploadCounter = 0;

  readonly statuses = signal<MediaStatus[]>([]);
  readonly uploads = signal<MediaUpload[]>([]);
  readonly error = signal<string | undefined>(undefined);
  readonly notes = signal<Record<string, string>>(this.restoreNotes());
  readonly byKey = computed(() => {
    const groups = new Map<string, MediaStatus[]>();
    for (const status of this.statuses()) {
      groups.set(status.key, [...(groups.get(status.key) ?? []), status]);
    }
    return groups;
  });
  readonly active = computed(
    () => this.statuses().some(isPending) || this.uploads().some((upload) => !upload.error),
  );

  constructor() {
    effect(() => {
      if (this.account.signedIn()) {
        untracked(() => void this.refresh());
      }
    });
  }

  async refresh(): Promise<void> {
    try {
      this.statuses.set(await this.api.mediaStatuses());
    } catch (error) {
      this.handleFailure(error);
    }
    this.schedulePoll();
  }

  doneCount(key: string): number {
    return (this.byKey().get(key) ?? []).filter((status) => status.status === 'done').length;
  }

  contentLabel(key: string): string | undefined {
    const count = this.doneCount(key);
    return count > 0 ? `${MEDIA_TEXTS.contentLink} (${count})` : undefined;
  }

  noteFor(key: string): string {
    return this.notes()[key] ?? '';
  }

  setNote(key: string, text: string): void {
    const clipped = text.slice(0, MEDIA_NOTE_MAX_LENGTH);
    this.notes.update((current) => {
      const next = { ...current };
      if (clipped) {
        next[key] = clipped;
      } else {
        delete next[key];
      }
      return next;
    });
    try {
      localStorage.setItem(MEDIA_NOTES_STORAGE_KEY, JSON.stringify(this.notes()));
    } catch {
      return;
    }
  }

  contentPending(key: string): boolean {
    return (this.byKey().get(key) ?? []).some(isPending);
  }

  private async readable(file: File): Promise<Blob | undefined> {
    if (file.size > MEDIA_COPY_MAX_BYTES) {
      return file;
    }
    try {
      const copy = new Blob([await file.arrayBuffer()], { type: file.type });
      return copy.size === file.size ? copy : undefined;
    } catch {
      return undefined;
    }
  }

  async upload(
    item: PlanItem,
    file: File,
    unit: string,
    overlay: string,
    note = '',
  ): Promise<void> {
    this.uploadCounter += 1;
    const id = `upload-${this.uploadCounter}`;
    const entry: MediaUpload = { id, key: item.id, unit, name: file.name, progress: 0 };
    if (file.size === 0) {
      this.uploads.update((current) => [...current, { ...entry, error: MEDIA_TEXTS.emptyFile }]);
      return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      this.uploads.update((current) => [...current, { ...entry, error: MEDIA_TEXTS.tooLarge }]);
      return;
    }
    this.uploads.update((current) => [...current, entry]);
    const payload = await this.readable(file);
    if (!payload) {
      this.uploads.update((current) =>
        current.map((upload) =>
          upload.id === id ? { ...upload, error: MEDIA_TEXTS.unreadable } : upload,
        ),
      );
      return;
    }

    const meta: MediaUploadMeta = {
      key: item.id,
      unit,
      format: item.format,
      pillar: item.pillar,
      idea: item.idea,
      overlay,
      note: note.trim().slice(0, MEDIA_NOTE_MAX_LENGTH) || undefined,
    };
    const form = new FormData();
    form.append('data', JSON.stringify(meta));
    form.append('file', payload, file.name);

    try {
      const last = await lastValueFrom(
        this.api.uploadMedia(form).pipe(
          tap((event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              this.setProgress(id, Math.min(100, Math.floor((event.loaded / event.total) * 100)));
            }
          }),
        ),
      );
      const created = last.type === HttpEventType.Response ? last.body : undefined;
      this.dismissUpload(id);
      if (created) {
        this.statuses.update((current) => [
          ...current.filter((status) => status.id !== created.id),
          created,
        ]);
        this.schedulePoll();
      } else {
        await this.refresh();
      }
    } catch (error) {
      const message = this.clientErrors.report(error, 'media', MEDIA_TEXTS.uploadFailed);
      this.uploads.update((current) =>
        current.map((upload) => (upload.id === id ? { ...upload, error: message } : upload)),
      );
    }
  }

  dismissUpload(id: string): void {
    this.uploads.update((current) => current.filter((upload) => upload.id !== id));
  }

  async remove(id: string): Promise<boolean> {
    this.error.set(undefined);
    try {
      await this.api.deleteMedia(id);
      this.forget(id);
      this.statuses.update((current) => current.filter((status) => status.id !== id));
      return true;
    } catch (error) {
      this.handleFailure(error);
      return false;
    }
  }

  async redo(id: string, wish: string): Promise<boolean> {
    this.error.set(undefined);
    try {
      const queued = await this.api.redoMedia(id, wish.trim());
      this.forget(id);
      this.statuses.update((current) =>
        current.map((status) => (status.id === id ? queued : status)),
      );
      this.schedulePoll();
      return true;
    } catch (error) {
      this.handleFailure(error);
      return false;
    }
  }

  urlFor(status: MediaStatus): Promise<string> {
    return this.urlOf(status.id, () => this.api.mediaFile(status.id));
  }

  thumbUrlFor(status: MediaStatus): Promise<string> {
    return this.urlOf(`${status.id}:thumb`, () => this.api.mediaThumb(status.id));
  }

  fileNameFor(status: MediaStatus): string {
    const siblings = (this.byKey().get(status.key) ?? []).filter(
      (candidate) => candidate.status === 'done',
    );
    const position = siblings.findIndex((candidate) => candidate.id === status.id);
    const number = position >= 0 ? position + 1 : siblings.length + 1;
    const extension =
      MEDIA_FILE_EXTENSIONS[status.result?.type ?? ''] ?? MEDIA_KIND_EXTENSIONS[status.kind];
    return `${status.key}-${number}.${extension}`;
  }

  async save(status: MediaStatus): Promise<MediaSaveResult> {
    const blob = await this.blobOf(status.id, () => this.api.mediaFile(status.id));
    const name = this.fileNameFor(status);
    const file = new File([blob], name, { type: status.result?.type ?? blob.type });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (error) {
        if (isAbort(error)) {
          return 'cancelled';
        }
      }
    }
    await this.download(status, name);
    return 'downloaded';
  }

  stop(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async download(status: MediaStatus, name: string): Promise<void> {
    const url = await this.urlFor(status);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  private blobOf(cacheKey: string, load: () => Promise<Blob>): Promise<Blob> {
    let blob = this.blobs.get(cacheKey);
    if (!blob) {
      blob = load();
      this.blobs.set(cacheKey, blob);
      blob.catch(() => this.blobs.delete(cacheKey));
    }
    return blob;
  }

  private urlOf(cacheKey: string, load: () => Promise<Blob>): Promise<string> {
    let url = this.urls.get(cacheKey);
    if (!url) {
      url = this.blobOf(cacheKey, load).then((blob) => URL.createObjectURL(blob));
      this.urls.set(cacheKey, url);
      url.catch(() => this.urls.delete(cacheKey));
    }
    return url;
  }

  private forget(id: string): void {
    for (const cacheKey of [id, `${id}:thumb`]) {
      const url = this.urls.get(cacheKey);
      this.urls.delete(cacheKey);
      this.blobs.delete(cacheKey);
      void url?.then((value) => URL.revokeObjectURL(value));
    }
  }

  private restoreNotes(): Record<string, string> {
    try {
      const raw = localStorage.getItem(MEDIA_NOTES_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }

  private setProgress(id: string, progress: number): void {
    this.uploads.update((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, progress } : upload)),
    );
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    if (this.statuses().some(isPending)) {
      this.pollTimer = setTimeout(() => void this.refresh(), MEDIA_POLL_MS);
    }
  }

  private handleFailure(error: unknown): void {
    this.error.set(this.clientErrors.report(error, 'media', MEDIA_TEXTS.failedAction));
  }
}
