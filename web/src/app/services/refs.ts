import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { REFS_ORDER_DELAY_MS, REFS_POLL_MS, REFS_TEXTS } from '../constants';
import { ChatApiError, PlanItem, RefFileMeta, RefOrderItem, RefStatus } from '../models';
import { Access } from './access';
import { Account } from './account';
import { CalendarPlan } from './calendar-plan';
import { ChatApi } from './chat-api';
import { ErrorLog } from './error-log';

function toOrderItem(item: PlanItem): RefOrderItem {
  return {
    key: item.id,
    format: item.format,
    pillar: item.pillar,
    idea: item.idea,
    date: item.date,
  };
}

function signatureOf(items: RefOrderItem[]): string {
  return items
    .map((item) => `${item.key}|${item.format}|${item.pillar}|${item.idea}|${item.date}`)
    .join('\n');
}

@Service()
export class Refs {
  private readonly api = inject(ChatApi);
  private readonly access = inject(Access);
  private readonly account = inject(Account);
  private readonly plan = inject(CalendarPlan);
  private readonly errorLog = inject(ErrorLog);
  private readonly urls = new Map<string, Promise<string>>();
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private orderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSignature = '';

  readonly statuses = signal<RefStatus[]>([]);
  readonly error = signal<string | undefined>(undefined);
  readonly busy = signal(false);
  readonly byKey = computed(() => new Map(this.statuses().map((status) => [status.key, status])));
  readonly blocked = computed(() => this.statuses().some((status) => status.stale));
  readonly active = computed(() =>
    this.statuses().some((status) => status.status === 'queued' || status.status === 'running'),
  );

  constructor() {
    effect(() => {
      const items = this.plan.items().map(toOrderItem);
      const ready = this.account.signedIn();
      untracked(() => {
        if (ready) {
          this.scheduleOrder(items);
        }
      });
    });
  }

  async refresh(): Promise<void> {
    try {
      this.statuses.set(await this.api.refStatuses());
    } catch (error) {
      this.handleFailure(error);
    }
    this.schedulePoll();
  }

  async confirmMade(key: string): Promise<boolean> {
    if (this.busy()) {
      return false;
    }
    this.busy.set(true);
    this.error.set(undefined);
    try {
      await this.api.confirmRefsMade(key);
      this.forgetFiles(this.byKey().get(key)?.files ?? []);
      await this.refresh();
      return true;
    } catch (error) {
      this.handleFailure(error);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  urlFor(file: RefFileMeta): Promise<string> {
    let url = this.urls.get(file.id);
    if (!url) {
      url = this.api.refFile(file.id).then((blob) => URL.createObjectURL(blob));
      this.urls.set(file.id, url);
      url.catch(() => this.urls.delete(file.id));
    }
    return url;
  }

  stop(): void {
    clearTimeout(this.pollTimer);
    clearTimeout(this.orderTimer);
    this.pollTimer = undefined;
    this.orderTimer = undefined;
  }

  private scheduleOrder(items: RefOrderItem[]): void {
    const signature = signatureOf(items);
    if (signature === this.lastSignature || (items.length === 0 && this.lastSignature === '')) {
      return;
    }
    clearTimeout(this.orderTimer);
    this.orderTimer = setTimeout(() => void this.sendOrder(items, signature), REFS_ORDER_DELAY_MS);
  }

  private async sendOrder(items: RefOrderItem[], signature: string): Promise<void> {
    try {
      await this.api.orderRefs(items);
      this.lastSignature = signature;
      await this.refresh();
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    if (this.active()) {
      this.pollTimer = setTimeout(() => void this.refresh(), REFS_POLL_MS);
    }
  }

  private forgetFiles(files: RefFileMeta[]): void {
    for (const file of files) {
      const url = this.urls.get(file.id);
      this.urls.delete(file.id);
      void url?.then((value) => URL.revokeObjectURL(value));
    }
  }

  private handleFailure(error: unknown): void {
    if (error instanceof ChatApiError && error.unauthorized) {
      this.access.clear();
    }
    const message = error instanceof ChatApiError ? error.message : String(error);
    this.errorLog.record('send', message);
    this.error.set(message || REFS_TEXTS.failedAction);
  }
}
