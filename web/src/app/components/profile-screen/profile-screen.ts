import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { form, FormField, validate } from '@angular/forms/signals';
import {
  ONBOARDING_STEPS,
  AUDIT_TEXTS,
  PROFILE_CLOSE_LABEL,
  PROFILE_CONFIRM_LABEL,
  PROFILE_HINT,
  PROFILE_TITLE,
  PROFILE_UPDATE_LABEL,
} from '../../constants';
import { ProfileDraft } from '../../models';
import { Audit } from '../../services/audit';
import { Chat } from '../../services/chat';
import { Onboarding } from '../../services/onboarding';
import { validateAnswer } from '../../utils/answer-validation';

@Component({
  imports: [FormField],
  selector: 'app-profile-screen',
  styleUrl: './profile-screen.scss',
  templateUrl: './profile-screen.html',
})
export class ProfileScreen {
  readonly open = model(false);

  protected readonly chat = inject(Chat);
  protected readonly onboarding = inject(Onboarding);
  protected readonly audit = inject(Audit);
  protected readonly auditTexts = AUDIT_TEXTS;
  protected readonly title = PROFILE_TITLE;
  protected readonly hint = PROFILE_HINT;
  protected readonly closeLabel = PROFILE_CLOSE_LABEL;
  protected readonly steps = ONBOARDING_STEPS;
  protected readonly draft = signal<ProfileDraft>(this.onboarding.toDraft());
  protected readonly profileForm = form(this.draft, (path) => {
    ONBOARDING_STEPS.forEach((step) => {
      validate(path[step.field], ({ value }) => {
        const message = validateAnswer(step, value(), 'form');
        return message ? { kind: 'answer', message } : undefined;
      });
    });
  });
  protected readonly submitLabel = computed(() =>
    this.onboarding.strategy() ? PROFILE_UPDATE_LABEL : PROFILE_CONFIRM_LABEL,
  );

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) {
        untracked(() => this.draft.set(this.onboarding.toDraft()));
        element.showModal();
      } else if (!this.open() && element.open) {
        element.close();
      }
    });
  }

  protected errorOf(field: keyof ProfileDraft): string | undefined {
    return this.profileForm[field]().errors()[0]?.message;
  }

  protected onSubmit(): void {
    if (this.profileForm().invalid() || this.chat.busy()) {
      return;
    }
    this.onboarding.saveDraft(this.draft());
    this.open.set(false);
    this.chat.buildStrategy();
  }

  protected onDialogClosed(): void {
    if (!this.dialog().nativeElement.open) {
      this.open.set(false);
    }
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.open.set(false);
    }
  }
}
