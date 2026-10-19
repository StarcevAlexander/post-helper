import { Service, computed, inject, signal } from '@angular/core';
import { AUDIT_JOB_POLL_MS, AUDIT_JOB_TEXTS } from '../constants';
import { AuditJob, ChatApiError } from '../models';
import { Access } from './access';
import { Audit } from './audit';
import { ChatApi } from './chat-api';
import { ErrorLog } from './error-log';

const ACTIVE_STATUSES: readonly AuditJob['status'][] = ['queued', 'running'];

@Service()
export class AuditJobs {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly audit = inject(Audit);
  private readonly errorLog = inject(ErrorLog);

  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly job = signal<AuditJob | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly active = computed(() => {
    const status = this.job()?.status;
    return status !== undefined && ACTIVE_STATUSES.includes(status);
  });

  async refresh(): Promise<void> {
    try {
      const job = await this.api.latestAuditJob();
      this.job.set(job);
      this.error.set(undefined);
      this.adopt(job);
    } catch (error) {
      this.handleFailure(error, AUDIT_JOB_TEXTS.loadFailed);
    }
    this.schedule();
  }

  async order(handle: string, consent: boolean): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      this.job.set(await this.api.createAuditJob(handle, consent));
      this.schedule();
      return true;
    } catch (error) {
      this.handleFailure(error, AUDIT_JOB_TEXTS.createFailed);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async autoOrder(handle: string): Promise<void> {
    if (!this.access.granted() || this.audit.stored() || this.active()) {
      return;
    }
    await this.order(handle.trim(), true);
  }

  async cancel(): Promise<void> {
    const job = this.job();
    if (!job || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      await this.api.cancelAuditJob(job.id);
      await this.refresh();
    } catch (error) {
      this.handleFailure(error, AUDIT_JOB_TEXTS.loadFailed);
    } finally {
      this.busy.set(false);
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  reset(): void {
    this.stop();
    this.job.set(undefined);
    this.error.set(undefined);
  }

  private schedule(): void {
    this.stop();
    if (this.active()) {
      this.timer = setTimeout(() => void this.refresh(), AUDIT_JOB_POLL_MS);
    }
  }

  private adopt(job: AuditJob | undefined): void {
    if (job?.status === 'done') {
      this.audit.adoptJob(job);
    }
  }

  private handleFailure(error: unknown, fallback: string): void {
    if (error instanceof ChatApiError && error.unauthorized) {
      this.access.clear();
    }
    const message = error instanceof ChatApiError ? error.message : String(error);
    this.errorLog.record('send', message);
    this.error.set(message || fallback);
  }
}
