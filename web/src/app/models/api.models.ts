import { MessageRole } from './chat.models';

export interface ApiTurn {
  role: MessageRole;
  text: string;
}

export interface ApiReply {
  reply: string;
}

export interface ClientErrorReport {
  message: string;
  where: string;
  stack: string;
  version: string;
}

export interface ApiErrorBody {
  error?: string;
}

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly unauthorized = false,
    readonly insufficient = false,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}
