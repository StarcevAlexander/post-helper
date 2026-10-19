import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ChatMessage } from '../../models';

@Component({
  imports: [DatePipe],
  selector: 'app-message-bubble',
  styleUrl: './message-bubble.scss',
  templateUrl: './message-bubble.html',
})
export class MessageBubble {
  readonly message = input.required<ChatMessage>();
  readonly speaking = input(false);
  readonly canSpeak = input(false);
  readonly locked = input(false);
  readonly retryable = input(false);
  readonly retryRequested = output();
  readonly speakRequested = output();
  readonly stopRequested = output();
  readonly deleteRequested = output();

  protected readonly fromUser = computed(() => this.message().role === 'user');
  protected readonly speakable = computed(
    () =>
      this.canSpeak() &&
      !this.fromUser() &&
      !this.message().pending &&
      this.message().text.length > 0,
  );
}
