import { TestBed } from '@angular/core/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { AppUpdate } from './app-update';

describe('AppUpdate', () => {
  it('stays idle while the service worker is disabled', () => {
    TestBed.configureTestingModule({
      providers: [provideServiceWorker('ngsw-worker.js', { enabled: false })],
    });
    const update = TestBed.inject(AppUpdate);

    update.start();

    expect(update.ready()).toBe(false);
  });
});
