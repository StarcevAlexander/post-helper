import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  isDevMode,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { ReportingErrorHandler } from './services/error-reporter';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
  ],
};
