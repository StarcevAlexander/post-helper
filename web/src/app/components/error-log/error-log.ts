import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  COPY_FEEDBACK_MS,
  ERROR_LOG_CLEAR_LABEL,
  ERROR_LOG_CLEAR_TEXT,
  ERROR_LOG_CLEAR_TITLE,
  ERROR_LOG_COPIED_LABEL,
  ERROR_LOG_COPY_FAILED_LABEL,
  ERROR_LOG_COPY_LABEL,
  ERROR_LOG_EMPTY_TEXT,
  ERROR_SOURCE_LABELS,
} from '../../constants';
import { ErrorLog } from '../../services/error-log';
import { ConfirmDialog } from '../confirm-dialog/confirm-dialog';

@Component({
  imports: [ConfirmDialog, DatePipe],
  selector: 'app-error-log',
  styleUrl: './error-log.scss',
  templateUrl: './error-log.html',
})
export class ErrorLogScreen {
  protected readonly errorLog = inject(ErrorLog);
  protected readonly emptyText = ERROR_LOG_EMPTY_TEXT;
  protected readonly clearLabel = ERROR_LOG_CLEAR_LABEL;
  protected readonly clearTitle = ERROR_LOG_CLEAR_TITLE;
  protected readonly clearText = ERROR_LOG_CLEAR_TEXT;
  protected readonly sourceLabels = ERROR_SOURCE_LABELS;
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');
  protected readonly clearConfirmOpen = signal(false);

  protected readonly newest = computed(() => [...this.errorLog.entries()].reverse());
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

  protected async onCopyClicked(): Promise<void> {
    const text = this.newest()
      .map(
        (entry) =>
          `${entry.createdAt.toLocaleString('ru-RU')} — ${this.sourceLabels[entry.source]}: ${entry.message}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copyState.set('copied');
    } catch {
      this.copyState.set('failed');
    }
    setTimeout(() => this.copyState.set('idle'), COPY_FEEDBACK_MS);
  }
}
