import { Component, inject } from '@angular/core';
import { FEEDBACK_TEXTS, MAX_FEEDBACK_CONTACT, MAX_FEEDBACK_TEXT } from '../../constants';
import { Feedback } from '../../services/feedback';
import { fieldValue } from '../../utils/form-events';

@Component({
  selector: 'app-feedback-screen',
  styleUrl: './feedback-screen.scss',
  templateUrl: './feedback-screen.html',
})
export class FeedbackScreen {
  protected readonly feedback = inject(Feedback);
  protected readonly texts = FEEDBACK_TEXTS;
  protected readonly maxText = MAX_FEEDBACK_TEXT;
  protected readonly maxContact = MAX_FEEDBACK_CONTACT;

  protected onTextInput(event: Event): void {
    this.feedback.setText(fieldValue(event));
  }

  protected onContactInput(event: Event): void {
    this.feedback.setContact(fieldValue(event));
  }
}
