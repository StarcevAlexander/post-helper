import { Component, computed, inject, input } from '@angular/core';
import { MEDIA_NOTE_MAX_LENGTH, MEDIA_TEXTS } from '../../constants';
import { Media } from '../../services/media';

@Component({
  selector: 'app-media-note',
  styleUrl: './media-note.scss',
  templateUrl: './media-note.html',
})
export class MediaNote {
  readonly itemId = input.required<string>();

  private readonly media = inject(Media);
  protected readonly texts = MEDIA_TEXTS;
  protected readonly maxLength = MEDIA_NOTE_MAX_LENGTH;
  protected readonly value = computed(() => this.media.noteFor(this.itemId()));

  protected onInput(textarea: HTMLTextAreaElement): void {
    this.media.setNote(this.itemId(), textarea.value);
  }
}
