import { Service, inject } from '@angular/core';
import { ApiError } from '../models';
import { APP_VERSION } from '../version';
import { Access } from './access';
import { ApiClient } from './api-client';

@Service()
export class ClientErrors {
  private readonly api = inject(ApiClient);
  private readonly access = inject(Access);

  report(error: unknown, where: string, fallback: string): string {
    if (error instanceof ApiError && error.unauthorized) {
      this.access.clear();
    }
    const message = error instanceof ApiError ? error.message : String(error);
    void this.api.reportClientError({ message, where, stack: '', version: APP_VERSION });
    return message || fallback;
  }
}
