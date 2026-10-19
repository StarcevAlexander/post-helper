import { Service, inject, signal } from '@angular/core';
import { AUDIT_STORAGE_KEY, AUDIT_TEXTS } from '../constants';
import { AuditJob, AuditResult, ChatApiError, StoredAudit } from '../models';
import { buildAuditDigest } from '../utils/audit-digest';
import { Access } from './access';
import { ChatApi } from './chat-api';
import { ErrorLog } from './error-log';
import { Onboarding } from './onboarding';

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isResult(value: unknown): value is AuditResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['summary'] === 'string' &&
    typeof candidate['bioSuggestion'] === 'string' &&
    typeof candidate['nameSuggestion'] === 'string' &&
    isStringList(candidate['strengths']) &&
    isStringList(candidate['problems']) &&
    isStringList(candidate['fixes']) &&
    isStringList(candidate['contentNotes']) &&
    isStringList(candidate['missing'])
  );
}

function isStoredAudit(value: unknown): value is StoredAudit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['createdAt'] === 'string' &&
    typeof candidate['imageCount'] === 'number' &&
    isResult(candidate['result'])
  );
}

@Service()
export class Audit {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly onboarding = inject(Onboarding);
  private readonly errorLog = inject(ErrorLog);

  readonly stored = signal<StoredAudit | undefined>(this.restore());
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly open = signal(false);

  show(): void {
    this.error.set(undefined);
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }

  async analyze(files: File[]): Promise<boolean> {
    const profile = this.onboarding.profile();
    if (this.busy() || files.length === 0) {
      return false;
    }
    if (!profile) {
      this.error.set(AUDIT_TEXTS.needProfile);
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const result = await this.api.requestAudit(profile, files);
      this.stored.set({ createdAt: new Date().toISOString(), imageCount: files.length, result });
      this.save();
      this.onboarding.setAudit(buildAuditDigest(result));
      return true;
    } catch (error) {
      if (error instanceof ChatApiError && error.unauthorized) {
        this.access.clear();
      }
      const message = error instanceof ChatApiError ? error.message : String(error);
      this.errorLog.record('send', message);
      this.error.set(message || AUDIT_TEXTS.failed);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  adoptJob(job: AuditJob): void {
    if (!job.result || this.stored()?.jobId === job.id) {
      return;
    }
    this.stored.set({
      createdAt: new Date().toISOString(),
      imageCount: 0,
      jobId: job.id,
      result: job.result,
    });
    this.save();
    this.onboarding.setAudit(buildAuditDigest(job.result));
  }

  clear(): void {
    this.stored.set(undefined);
    this.onboarding.setAudit(undefined);
    try {
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      return;
    }
  }

  reset(): void {
    this.stored.set(undefined);
    this.error.set(undefined);
    try {
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      return;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.stored()));
    } catch {
      return;
    }
  }

  private restore(): StoredAudit | undefined {
    try {
      const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : undefined;
      return isStoredAudit(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
