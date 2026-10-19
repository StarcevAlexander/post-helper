import { InjectionToken } from '@angular/core';

export const PAGE_RELOAD = new InjectionToken<() => void>('page reload', {
  providedIn: 'root',
  factory: () => () => window.location.reload(),
});
