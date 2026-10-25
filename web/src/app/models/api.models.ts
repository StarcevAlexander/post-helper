import { ServerState } from './account.models';

export interface ClientErrorReport {
  message: string;
  where: string;
  stack: string;
  version: string;
}

export interface ApiErrorBody {
  error?: string;
  state?: ServerState;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly unauthorized = false,
    readonly insufficient = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class StateConflictError extends ApiError {
  constructor(
    message: string,
    readonly state: ServerState,
  ) {
    super(message);
    this.name = 'StateConflictError';
  }
}
