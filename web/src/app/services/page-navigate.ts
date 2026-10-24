import { InjectionToken } from '@angular/core';

export const PAGE_NAVIGATE = new InjectionToken<(url: string) => void>('page navigate', {
  providedIn: 'root',
  factory: () => (url) => window.location.assign(url),
});
