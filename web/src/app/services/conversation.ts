import { Service } from '@angular/core';
import { CONVERSATION_STORAGE_KEY } from '../constants';

@Service()
export class Conversation {
  private current = this.read() ?? this.create();

  id(): string {
    return this.current;
  }

  reset(): void {
    this.current = this.create();
  }

  private create(): string {
    const id = crypto.randomUUID();
    try {
      localStorage.setItem(CONVERSATION_STORAGE_KEY, id);
    } catch {
      return id;
    }
    return id;
  }

  private read(): string | undefined {
    try {
      return localStorage.getItem(CONVERSATION_STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }
}
