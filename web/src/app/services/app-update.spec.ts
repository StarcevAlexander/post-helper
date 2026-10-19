import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { UPDATE_APPLY_RETRY_MS, UPDATE_CHECK_INTERVAL_MS } from '../constants';
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

  function setUp(enabled = true): void {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays idle while the service worker is disabled', () => {
    setUp(false);

    update.start();

    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    expect(update.ready()).toBe(false);
  });

  it('checks for a new version at start', () => {
    setUp();

    update.start();

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
    sw.checkForUpdate.mockClear();

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3 + 10);

    expect(sw.checkForUpdate).toHaveBeenCalledTimes(3);
  });

  it('checks when the app returns to the screen and when the network comes back', () => {
    setUp();
    update.start();
    sw.checkForUpdate.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));

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
});
