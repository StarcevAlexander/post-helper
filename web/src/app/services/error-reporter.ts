import { ErrorHandler, Injector, inject } from '@angular/core';
import { APP_VERSION } from '../version';
import { ChatApi } from './chat-api';

export class ReportingErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);

  handleError(error: unknown): void {
    console.error(error);
    const failure = error instanceof Error ? error : new Error(String(error));
    void this.injector.get(ChatApi).reportClientError({
      message: failure.message,
      where: failure.name,
      stack: failure.stack ?? '',
      version: APP_VERSION,
    });
  }
}
