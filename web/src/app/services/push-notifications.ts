import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { NEVER } from 'rxjs';
import { NOTICE_HIDE_DELAY_MS, PUSH_OFFER_DISMISSED_KEY, PUSH_TEXTS } from '../constants';
import { ApiError, PushSubscriptionPayload } from '../models';
import { browserTimeZone } from '../utils/time-zone';
import { Account } from './account';
import { ApiClient } from './api-client';

function toPayload(subscription: PushSubscription): PushSubscriptionPayload | undefined {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.['p256dh'] || !keys['auth']) {
    return undefined;
  }
  return {
    endpoint,
    keys: { p256dh: keys['p256dh'], auth: keys['auth'] },
    timeZone: browserTimeZone(),
  };
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PUSH_OFFER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

@Service()
export class PushNotifications {
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly api = inject(ApiClient);
  private readonly account = inject(Account);
  private readonly subscription = toSignal(this.swPush?.subscription ?? NEVER, {
    initialValue: null,
  });
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private syncedEndpoint = '';

  readonly supported =
    !!this.swPush?.isEnabled && typeof Notification !== 'undefined' && 'PushManager' in window;
  readonly subscribed = computed(() => this.subscription() !== null);
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly dismissed = signal(readDismissed());

  constructor() {
    effect(() => {
      const subscription = this.subscription();
      const master = this.account.signedIn();
      untracked(() => {
        if (subscription && master && subscription.endpoint !== this.syncedEndpoint) {
          void this.upload(subscription).catch(() => undefined);
        }
      });
    });
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(PUSH_OFFER_DISMISSED_KEY, '1');
    } catch {
      return;
    }
  }

  async enable(): Promise<void> {
    if (this.busy() || !this.supported || !this.swPush) {
      return;
    }
    this.busy.set(true);
    try {
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== 'granted') {
        this.showNotice(PUSH_TEXTS.denied);
        return;
      }
      const serverPublicKey = await this.api.pushPublicKey();
      const subscription = await this.swPush.requestSubscription({ serverPublicKey });
      await this.upload(subscription);
      this.showNotice(PUSH_TEXTS.enabled);
    } catch (error) {
      this.showNotice(error instanceof ApiError ? error.message : PUSH_TEXTS.failed);
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    const subscription = this.subscription();
    if (this.busy() || !this.swPush || !subscription) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.unsubscribePush(subscription.endpoint).catch(() => undefined);
      await this.swPush.unsubscribe();
      this.syncedEndpoint = '';
      this.showNotice(PUSH_TEXTS.disabled);
    } catch {
      this.showNotice(PUSH_TEXTS.failed);
    } finally {
      this.busy.set(false);
    }
  }

  private async upload(subscription: PushSubscription): Promise<void> {
    const payload = toPayload(subscription);
    if (!payload) {
      throw new ApiError(PUSH_TEXTS.failed);
    }
    const previous = this.syncedEndpoint;
    this.syncedEndpoint = payload.endpoint;
    try {
      await this.api.subscribePush(payload);
    } catch (error) {
      this.syncedEndpoint = previous;
      throw error;
    }
  }

  private showNotice(text: string): void {
    clearTimeout(this.noticeTimer);
    this.notice.set(text);
    this.noticeTimer = setTimeout(() => this.notice.set(''), NOTICE_HIDE_DELAY_MS);
  }
}
