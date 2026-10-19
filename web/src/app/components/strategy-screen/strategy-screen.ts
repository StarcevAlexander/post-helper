import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CADENCE_LABELS,
  CLEAR_CONFIRM_TIMEOUT_MS,
  STRATEGY_BUILD_LABEL,
  STRATEGY_CLOSE_LABEL,
  STRATEGY_EDIT_PROFILE_LABEL,
  STRATEGY_EMPTY_TEXT,
  STRATEGY_RESTART_CONFIRM_LABEL,
  STRATEGY_RESTART_LABEL,
  STRATEGY_SECTIONS,
  STRATEGY_TITLE,
} from '../../constants';
import { Chat } from '../../services/chat';
import { Onboarding } from '../../services/onboarding';

@Component({
  selector: 'app-strategy-screen',
  styleUrl: './strategy-screen.scss',
  templateUrl: './strategy-screen.html',
})
export class StrategyScreen {
  readonly open = model(false);
  readonly profileRequested = output();

  protected readonly chat = inject(Chat);
  protected readonly onboarding = inject(Onboarding);
  protected readonly title = STRATEGY_TITLE;
  protected readonly closeLabel = STRATEGY_CLOSE_LABEL;
  protected readonly emptyText = STRATEGY_EMPTY_TEXT;
  protected readonly buildLabel = STRATEGY_BUILD_LABEL;
  protected readonly editProfileLabel = STRATEGY_EDIT_PROFILE_LABEL;
  protected readonly sections = STRATEGY_SECTIONS;
  protected readonly confirmingRestart = signal(false);
  protected readonly restartLabel = computed(() =>
    this.confirmingRestart() ? STRATEGY_RESTART_CONFIRM_LABEL : STRATEGY_RESTART_LABEL,
  );
  protected readonly cadence = computed(() => {
    const cadence = this.onboarding.strategy()?.cadence;
    if (!cadence) {
      return [];
    }
    return [
      { label: CADENCE_LABELS.reels, count: cadence.reels },
      { label: CADENCE_LABELS.posts, count: cadence.posts },
      { label: CADENCE_LABELS.stories, count: cadence.stories },
    ];
  });

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) {
        element.showModal();
      } else if (!this.open() && element.open) {
        element.close();
        this.confirmingRestart.set(false);
      }
    });
  }

  protected onProfileClicked(): void {
    this.open.set(false);
    this.profileRequested.emit();
  }

  protected onRestartClicked(): void {
    if (!this.confirmingRestart()) {
      this.confirmingRestart.set(true);
      setTimeout(() => this.confirmingRestart.set(false), CLEAR_CONFIRM_TIMEOUT_MS);
      return;
    }
    this.confirmingRestart.set(false);
    this.open.set(false);
    this.chat.restartOnboarding();
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
