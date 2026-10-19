import { Service, signal } from '@angular/core';
import {
  NOTICE_HIDE_DELAY_MS,
  NOTIFY_DENIED_TEXT,
  NOTIFY_FAILED_TEXT,
  NOTIFY_SCHEDULED_TEXT,
  NOTIFY_UNSUPPORTED_TEXT,
  TEST_NOTIFICATION_BODY,
  TEST_NOTIFICATION_DELAY_MS,
  TEST_NOTIFICATION_ICON,
  TEST_NOTIFICATION_TITLE,
} from '../constants';

@Service()
export class TestNotification {
  readonly waiting = signal(false);
  readonly notice = signal('');

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  async schedule(): Promise<void> {
    if (this.waiting()) {
      return;
    }
    if (typeof Notification === 'undefined') {
      this.showNotice(NOTIFY_UNSUPPORTED_TEXT);
      return;
    }

    this.waiting.set(true);
    try {
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== 'granted') {
        this.waiting.set(false);
        this.showNotice(NOTIFY_DENIED_TEXT);
        return;
      }
    } catch {
      this.waiting.set(false);
      this.showNotice(NOTIFY_FAILED_TEXT);
      return;
    }

    this.showNotice(NOTIFY_SCHEDULED_TEXT);
    setTimeout(() => void this.show(), TEST_NOTIFICATION_DELAY_MS);
  }

  private async show(): Promise<void> {
    try {
      const options = { body: TEST_NOTIFICATION_BODY, icon: TEST_NOTIFICATION_ICON };
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.showNotification(TEST_NOTIFICATION_TITLE, options);
      } else {
        new Notification(TEST_NOTIFICATION_TITLE, options);
      }
      this.notice.set('');
    } catch {
      this.showNotice(NOTIFY_FAILED_TEXT);
    } finally {
      this.waiting.set(false);
    }
  }

  private showNotice(text: string): void {
    clearTimeout(this.noticeTimer);
    this.notice.set(text);
    this.noticeTimer = setTimeout(() => this.notice.set(''), NOTICE_HIDE_DELAY_MS);
  }
}
