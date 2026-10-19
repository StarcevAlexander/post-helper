import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  COPY_FEEDBACK_MS,
  ERROR_LOG_CLEAR_LABEL,
  ERROR_LOG_CLEAR_TEXT,
  ERROR_LOG_COPIED_LABEL,
  ERROR_LOG_COPY_FAILED_LABEL,
  ERROR_LOG_COPY_LABEL,
  REQUEST_LOG_CLEAR_TITLE,
  REQUEST_LOG_EMPTY_TEXT,
  REQUEST_LOG_ERROR_LABEL,
  REQUEST_LOG_NO_RESPONSE_TEXT,
  REQUEST_LOG_RECEIVED_LABEL,
  REQUEST_LOG_SENT_LABEL,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_SUMMARIES,
} from '../../constants';
import { RequestEntry } from '../../models';
import { RequestLog } from '../../services/request-log';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';

@Component({
  imports: [ConfirmDialog, DatePipe],
  selector: 'app-request-log',
  styleUrl: './request-log.scss',
  templateUrl: './request-log.html',
})
export class RequestLogScreen {
  protected readonly requestLog = inject(RequestLog);
  protected readonly emptyText = REQUEST_LOG_EMPTY_TEXT;
  protected readonly clearLabel = ERROR_LOG_CLEAR_LABEL;
  protected readonly clearTitle = REQUEST_LOG_CLEAR_TITLE;
  protected readonly clearText = ERROR_LOG_CLEAR_TEXT;
  protected readonly sentLabel = REQUEST_LOG_SENT_LABEL;
  protected readonly noResponseText = REQUEST_LOG_NO_RESPONSE_TEXT;
  protected readonly statusLabels = REQUEST_STATUS_LABELS;
  protected readonly statusSummaries = REQUEST_STATUS_SUMMARIES;
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  protected readonly clearConfirmOpen = signal(false);
  protected readonly expandedId = signal<string | undefined>(undefined);

  protected readonly newest = computed(() => [...this.requestLog.entries()].reverse());
  protected readonly copyLabel = computed(() => {
    switch (this.copyState()) {
      case 'copied':
        return ERROR_LOG_COPIED_LABEL;
      case 'failed':
        return ERROR_LOG_COPY_FAILED_LABEL;
      default:
        return ERROR_LOG_COPY_LABEL;
    }
  });

  protected receivedLabel(entry: RequestEntry): string {
    return entry.status === 'error' ? REQUEST_LOG_ERROR_LABEL : REQUEST_LOG_RECEIVED_LABEL;
  }

  protected duration(entry: RequestEntry): string {
    const ms = entry.durationMs;
    if (ms === undefined) {
      return '';
    }
    return ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
  }

  protected onEntryClicked(id: string): void {
    this.expandedId.update((current) => (current === id ? undefined : id));
  }

  protected async onCopyClicked(): Promise<void> {
    const text = this.newest()
      .map((entry) => this.describe(entry))
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copyState.set('copied');
    } catch {
      this.copyState.set('failed');
    }
    setTimeout(() => this.copyState.set('idle'), COPY_FEEDBACK_MS);
  }

  private describe(entry: RequestEntry): string {
    const duration = this.duration(entry);
    const head = [
      entry.createdAt.toLocaleString('ru-RU'),
      entry.description,
      this.statusSummaries[entry.status],
      duration,
    ]
      .filter(Boolean)
      .join(' — ');
    return [
      head,
      `${this.sentLabel}: ${entry.sent}`,
      `${this.receivedLabel(entry)}: ${entry.received ?? this.noResponseText}`,
    ].join('\n');
  }
}
