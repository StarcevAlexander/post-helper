import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import {
  UPDATE_ATTEMPTS_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_TIMEOUT_MS,
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
  let hang = false;

  function setUp(enabled = true): void {
    published = undefined;
    hang = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (hang) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return published === undefined
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: true, json: () => Promise.resolve({ version: published }) });
      }),
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

  it('shows the loader from the very start and hides it when the version is current', async () => {
    setUp();
    published = APP_VERSION;
    expect(update.checking()).toBe(true);

    update.start();
    await settle();

    expect(update.checking()).toBe(false);
    expect(update.updating()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not keep the user waiting when the check hangs or the network is off', async () => {
    setUp();
    hang = true;

    update.start();
    expect(update.checking()).toBe(true);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS + 10);

    expect(update.checking()).toBe(false);
    expect(update.updating()).toBe(false);
  });

  it('stays quiet while the service worker is disabled and nothing new is out', async () => {
    setUp(false);

    update.start();
    await settle();

    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    expect(update.ready()).toBe(false);
    expect(update.checking()).toBe(false);
  });

  it('checks for a new version in the service worker at start', async () => {
    setUp();

    update.start();
    await settle();

    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the loader while a newer version is downloaded at launch, then installs it', async () => {
    setUp();
    published = '999.0.0';
    update.start();
    await settle();

    expect(update.checking()).toBe(false);
    expect(update.updating()).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    sw.versionUpdates.next(versionReady());
    await vi.advanceTimersByTimeAsync(600);

    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when the new version does not arrive in time at launch', async () => {
    setUp();
    published = '999.0.0';
    update.start();
    await settle();

    await vi.advanceTimersByTimeAsync(UPDATE_LAUNCH_WAIT_MS + 1000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('gives up the loader after three launches without success', async () => {
    setUp();
    published = '999.0.0';
    sessionStorage.setItem(UPDATE_ATTEMPTS_KEY, '999.0.0:3');

    update.start();
    await settle();

    expect(update.updating()).toBe(false);
    expect(update.checking()).toBe(false);
  });

  it('reloads the page itself at launch when there is no service worker and a newer version is out', async () => {
    setUp(false);
    published = '999.0.0';

    update.start();
    await vi.advanceTimersByTimeAsync(UPDATE_LAUNCH_WAIT_MS);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never updates the running app by itself: it only offers the update', async () => {
    setUp();
    update.start();
    await settle();
    published = '999.0.0';

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    sw.versionUpdates.next(versionReady());
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);

    expect(update.updating()).toBe(false);
    expect(update.ready()).toBe(true);
    expect(sw.activateUpdate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('installs the offered update only when the user presses the button', async () => {
    setUp();
    update.start();
    await settle();
    sw.versionUpdates.next(versionReady());
    await settle();

    await update.apply();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(sw.activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(update.ready()).toBe(false);
  });

  it('does not reload twice for two quick presses', async () => {
    setUp();
    update.start();
    await settle();
    sw.versionUpdates.next(versionReady());

    await Promise.all([update.apply(), update.apply()]);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads the page when the update cannot be installed', async () => {
    setUp();
    update.start();
    await settle();
    sw.activateUpdate.mockRejectedValueOnce(new Error('boom'));

    await update.apply();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks again every ten minutes, when the app returns and when the network comes back', async () => {
    setUp();
    update.start();
    await settle();
    sw.checkForUpdate.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2 + 10);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(4);
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
