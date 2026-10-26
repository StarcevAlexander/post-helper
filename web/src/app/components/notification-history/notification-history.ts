import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DAY_FORMAT, NOTICE_REASON_TEXTS, NOTICE_TEXTS, NOTICE_TIME_FORMAT } from '../../constants';
import { NoticeRow, NoticeView } from '../../models';
import { Notices } from '../../services/notices';
import { fromDateKey } from '../../utils/date-utils';

@Component({
  selector: 'app-notification-history',
  styleUrl: './notification-history.scss',
  templateUrl: './notification-history.html',
})
export class NotificationHistory {
  protected readonly notices = inject(Notices);
  private readonly router = inject(Router);
  protected readonly texts = NOTICE_TEXTS;
  protected readonly checking = signal<string | undefined>(undefined);
  protected readonly failed = signal<string | undefined>(undefined);

  protected readonly rows = computed<NoticeRow[]>(() =>
    this.notices.items().map((notice) => ({
      notice,
      when: NOTICE_TIME_FORMAT.format(new Date(notice.sentAt)),
      note: this.noteFor(notice),
      canOpen: notice.state === 'actual' && !!notice.link,
    })),
  );

  constructor() {
    void this.notices.load();
  }

  protected onRetry(): void {
    void this.notices.load();
  }

  protected async onMore(id: string): Promise<void> {
    if (this.checking()) {
      return;
    }
    this.checking.set(id);
    this.failed.set(undefined);
    try {
      const fresh = await this.notices.recheck(id);
      if (fresh.state === 'actual' && fresh.link) {
        await this.router.navigateByUrl(fresh.link);
      }
    } catch {
      this.failed.set(id);
    } finally {
      this.checking.set(undefined);
    }
  }

  private noteFor(notice: NoticeView): string | undefined {
    if (notice.reason === 'moved') {
      return notice.movedTo
        ? `${NOTICE_TEXTS.movedTo} ${DAY_FORMAT.format(fromDateKey(notice.movedTo))}`
        : undefined;
    }
    return notice.reason ? NOTICE_REASON_TEXTS[notice.reason] : undefined;
  }
}
