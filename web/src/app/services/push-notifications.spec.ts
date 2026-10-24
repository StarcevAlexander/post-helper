import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';
import {
  API_DEV_URL,
  API_PUSH_KEY_PATH,
  API_PUSH_SUBSCRIBE_PATH,
  API_PUSH_UNSUBSCRIBE_PATH,
  PUSH_TEXTS,
} from '../constants';
import { Account } from './account';
import { PushNotifications } from './push-notifications';

const keyUrl = `${API_DEV_URL}${API_PUSH_KEY_PATH}`;
const subscribeUrl = `${API_DEV_URL}${API_PUSH_SUBSCRIBE_PATH}`;
const unsubscribeUrl = `${API_DEV_URL}${API_PUSH_UNSUBSCRIBE_PATH}`;

function fakeSubscription(endpoint: string): PushSubscription {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'key', auth: 'secret' } }),
  } as unknown as PushSubscription;
}

interface FakeSwPush {
  isEnabled: boolean;
  subscription: BehaviorSubject<PushSubscription | null>;
  requestSubscription: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

describe('PushNotifications', () => {
  let http: HttpTestingController;
  let swPush: FakeSwPush;

  function setup(
    options: { enabled?: boolean; existing?: PushSubscription } = {},
  ): PushNotifications {
    swPush = {
      isEnabled: options.enabled ?? true,
      subscription: new BehaviorSubject<PushSubscription | null>(options.existing ?? null),
      requestSubscription: vi.fn(async () => {
        const created = fakeSubscription('https://push.example/new');
        swPush.subscription.next(created);
        return created;
      }),
      unsubscribe: vi.fn(async () => swPush.subscription.next(null)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SwPush, useValue: swPush },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(PushNotifications);
  }

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn(async () => 'granted'),
    });
    vi.stubGlobal('PushManager', class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('is unavailable when the service worker is off', async () => {
    const service = setup({ enabled: false });

    await service.enable();

    expect(service.supported).toBe(false);
    expect(swPush.requestSubscription).not.toHaveBeenCalled();
    http.verify();
  });

  it('subscribes with the server key and sends the subscription to the server', async () => {
    const service = setup();

    const enabling = service.enable();
    const keyRequest = await vi.waitFor(() => http.expectOne(keyUrl));
    keyRequest.flush({ publicKey: 'server-key' });
    const subscribeRequest = await vi.waitFor(() => http.expectOne(subscribeUrl));
    subscribeRequest.flush(null, { status: 204, statusText: 'No Content' });
    await enabling;
    TestBed.tick();

    expect(swPush.requestSubscription).toHaveBeenCalledWith({ serverPublicKey: 'server-key' });
    expect(subscribeRequest.request.body).toEqual({
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'key', auth: 'secret' },
    });
    expect(service.subscribed()).toBe(true);
    expect(service.notice()).toBe(PUSH_TEXTS.enabled);
    expect(service.busy()).toBe(false);
  });

  it('does not ask the server when the person denies the permission', async () => {
    const service = setup();
    vi.stubGlobal('Notification', {
      permission: 'denied',
      requestPermission: vi.fn(async () => 'denied'),
    });

    await service.enable();

    expect(service.notice()).toBe(PUSH_TEXTS.denied);
    expect(swPush.requestSubscription).not.toHaveBeenCalled();
    http.verify();
  });

  it('shows the server message when the server has push switched off', async () => {
    const service = setup();

    const enabling = service.enable();
    const keyRequest = await vi.waitFor(() => http.expectOne(keyUrl));
    keyRequest.flush({ error: 'off' }, { status: 503, statusText: 'Service Unavailable' });
    await enabling;

    expect(service.subscribed()).toBe(false);
    expect(service.notice()).not.toBe('');
    expect(service.busy()).toBe(false);
  });

  it('tells the server and the browser when the person turns it off', async () => {
    const service = setup({ existing: fakeSubscription('https://push.example/old') });
    TestBed.tick();

    const disabling = service.disable();
    const request = await vi.waitFor(() => http.expectOne(unsubscribeUrl));
    request.flush(null, { status: 204, statusText: 'No Content' });
    await disabling;
    TestBed.tick();

    expect(request.request.body).toEqual({ endpoint: 'https://push.example/old' });
    expect(swPush.unsubscribe).toHaveBeenCalled();
    expect(service.subscribed()).toBe(false);
    expect(service.notice()).toBe(PUSH_TEXTS.disabled);
  });

  it('re-sends an existing subscription once a master is known', async () => {
    const service = setup({ existing: fakeSubscription('https://push.example/old') });
    const account = TestBed.inject(Account);

    TestBed.tick();
    http.expectNone(subscribeUrl);
    account.info.set({ name: 'Анна', retentionDays: 1095 });
    TestBed.tick();

    const request = http.expectOne(subscribeUrl);
    request.flush(null, { status: 204, statusText: 'No Content' });
    await Promise.resolve();
    TestBed.tick();

    http.expectNone(subscribeUrl);
    expect(service.subscribed()).toBe(true);
  });
});
