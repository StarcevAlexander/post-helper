import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import {
  UPDATE_APPLY_RETRY_MS,
  UPDATE_ATTEMPTS_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_LAUNCH_WAIT_MS,
} from '../constants';
import { APP_VERSION } from '../version';
import { AppUpdate } from './app-update';
import { PAGE_RELOAD } from './page-reload';
import { Sync } from './sync';

class FakeSwUpdate {
  isEnabled = true;
  versionUpdates = new Subject<VersionEvent>();
  unrecoverable = new Subject<{ reason: string }>();
  checkForUpdate = vi.fn(() => Promise.resolve(false));
  activateUpdate = vi.fn(() => Promise.resolve(true));
}

function versionReady(): VersionEvent {
  return {
    type: 'VERSION_READY',
    currentVersion: { hash: 'old' },
    latestVersion: { hash: 'new' },
  };
}

describe('AppUpdate', () => {
  let sw: FakeSwUpdate;
  let reload: ReturnType<typeof vi.fn>;
  let update: AppUpdate;
  let flush: ReturnType<typeof vi.spyOn>;
  let published: string | undefined;

  function setUp(enabled = true): void {
    published = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        published === undefined
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: true, json: () => Promise.resolve({ version: published }) }),
      ),
    );
    sw = new FakeSwUpdate();
    sw.isEnabled = enabled;
    reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SwUpdate, useValue: sw },
        { provide: PAGE_RELOAD, useValue: reload },
      ],
    });
    update = TestBed.inject(AppUpdate);
    flush = vi.spyOn(TestBed.inject(Sync), 'flush').mockImplementation(() => undefined);
  }

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(1);
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays idle while the service worker is disabled', () => {
    setUp(false);

    update.start();

    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    expect(update.ready()).toBe(false);
  });

  it('checks for a new version at start', async () => {
    setUp();

    update.start();
    await settle();

    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('installs a new version by itself and reloads when the user is not busy', async () => {
    setUp();
    update.start();

    sw.versionUpdates.next(versionReady());
    await settle();

    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(update.ready()).toBe(false);
  });

  it('saves the pending data to the server before reloading', async () => {
    setUp();
    const order: string[] = [];
    flush.mockImplementation(() => void order.push('flush'));
    reload.mockImplementation(() => order.push('reload'));
    update.start();

    sw.versionUpdates.next(versionReady());
    await settle();

    expect(order).toEqual(['flush', 'reload']);
  });

  it('waits while the user is busy and installs as soon as the user is free', async () => {
    setUp();
    let busy = true;
    update.setIdleCheck(() => !busy);
    update.start();

    sw.versionUpdates.next(versionReady());
    await settle();
    expect(update.ready()).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UPDATE_APPLY_RETRY_MS * 3);
    expect(reload).not.toHaveBeenCalled();

    busy = false;
    await vi.advanceTimersByTimeAsync(UPDATE_APPLY_RETRY_MS + 10);

    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('applies the waiting update the moment the app comes back to the screen', async () => {
    setUp();
    let busy = true;
    update.setIdleCheck(() => !busy);
    update.start();
    sw.versionUpdates.next(versionReady());
    await settle();
    busy = false;

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks again every ten minutes', async () => {
    setUp();
    update.start();
    await settle();
    sw.checkForUpdate.mockClear();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3 + 10);

    expect(sw.checkForUpdate).toHaveBeenCalledTimes(3);
  });

  it('checks when the app returns to the screen and when the network comes back', async () => {
    setUp();
    update.start();
    await settle();
    sw.checkForUpdate.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not reload twice for two quick signals', async () => {
    setUp();
    update.start();

    sw.versionUpdates.next(versionReady());
    sw.versionUpdates.next(versionReady());
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('lets the button install the update at once even while busy', async () => {
    setUp();
    update.setIdleCheck(() => false);
    update.start();
    sw.versionUpdates.next(versionReady());
    await settle();
    expect(update.ready()).toBe(true);

    await update.apply();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting and tries again when the installation fails', async () => {
    setUp();
    update.start();
    sw.activateUpdate.mockRejectedValueOnce(new Error('boom'));

    sw.versionUpdates.next(versionReady());
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(update.ready()).toBe(true);

    await vi.advanceTimersByTimeAsync(UPDATE_APPLY_RETRY_MS + 10);

    expect(sw.activateUpdate).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the service worker cannot recover', () => {
    setUp();
    update.start();

    sw.unrecoverable.next({ reason: 'broken' });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('survives a failing check', async () => {
    setUp();
    sw.checkForUpdate.mockRejectedValue(new Error('offline'));

    expect(() => update.start()).not.toThrow();
    await settle();
  });

  it('shows the spinner at launch while the published version is newer, then installs it', async () => {
    setUp();
    published = '999.0.0';
    update.start();
    await settle();

    expect(update.updating()).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    sw.versionUpdates.next(versionReady());
    await vi.advanceTimersByTimeAsync(600);

    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when the new version does not arrive in time', async () => {
    setUp();
    published = '999.0.0';
    update.start();
    await settle();

    await vi.advanceTimersByTimeAsync(UPDATE_LAUNCH_WAIT_MS + 1000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('gives up the spinner after three launches without success', async () => {
    setUp();
    published = '999.0.0';
    sessionStorage.setItem(UPDATE_ATTEMPTS_KEY, '999.0.0:3');

    update.start();
    await settle();

    expect(update.updating()).toBe(false);
  });

  it('does not show the spinner when the published version is the same', async () => {
    setUp();
    published = APP_VERSION;

    update.start();
    await settle();

    expect(update.updating()).toBe(false);
    expect(update.ready()).toBe(false);
  });

  it('only offers the update, without a spinner, when a newer version appears while running', async () => {
    setUp();
    update.setIdleCheck(() => false);
    update.start();
    await settle();
    published = '999.0.0';

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    sw.versionUpdates.next(versionReady());
    await settle();

    expect(update.updating()).toBe(false);
    expect(update.ready()).toBe(true);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('reloads the page itself when there is no service worker and a newer version is out', async () => {
    setUp(false);
    published = '999.0.0';

    update.start();
    await vi.advanceTimersByTimeAsync(UPDATE_LAUNCH_WAIT_MS);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
