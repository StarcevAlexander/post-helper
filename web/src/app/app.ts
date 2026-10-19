import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AccessGate } from './components/access-gate/access-gate';
import { Composer } from './components/composer/composer';
import { MessageBubble } from './components/message-bubble/message-bubble';
import { SettingsPanel } from './components/settings-panel/settings-panel';
import { CalendarScreen } from './components/calendar-screen/calendar-screen';
import { ProfileScreen } from './components/profile-screen/profile-screen';
import { StrategyScreen } from './components/strategy-screen/strategy-screen';
import {
  CLEAR_CONFIRM_TIMEOUT_MS,
  HISTORY_CONTEXT_LABEL,
  NOTIFY_BUTTON_LABEL,
  NOTIFY_WAITING_LABEL,
  CALENDAR_OPEN_LABEL,
  SETTINGS_OPEN_LABEL,
  STRATEGY_OPEN_LABEL,
  UPDATE_BUTTON_LABEL,
} from './constants';
import { ComposerPayload } from './models';
import { Access } from './services/access';
import { AppUpdate } from './services/app-update';
import { Chat } from './services/chat';
import { Onboarding } from './services/onboarding';
import { Settings } from './services/settings';
import { Speech } from './services/speech';
import { TestNotification } from './services/test-notification';
import { APP_VERSION } from './version';

@Component({
  imports: [
    AccessGate,
    CalendarScreen,
    Composer,
    MessageBubble,
    ProfileScreen,
    SettingsPanel,
    StrategyScreen,
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly access = inject(Access);
  protected readonly chat = inject(Chat);
  protected readonly speech = inject(Speech);
  protected readonly settings = inject(Settings);
  protected readonly onboarding = inject(Onboarding);
  protected readonly appUpdate = inject(AppUpdate);
  protected readonly testNotification = inject(TestNotification);
  protected readonly notifyLabel = NOTIFY_BUTTON_LABEL;
  protected readonly notifyWaitingLabel = NOTIFY_WAITING_LABEL;
  protected readonly settingsOpenLabel = SETTINGS_OPEN_LABEL;
  protected readonly strategyOpenLabel = STRATEGY_OPEN_LABEL;
  protected readonly calendarOpenLabel = CALENDAR_OPEN_LABEL;
  protected readonly updateLabel = UPDATE_BUTTON_LABEL;
  protected readonly contextLabel = HISTORY_CONTEXT_LABEL;
  protected readonly version = APP_VERSION;
  protected readonly composing = signal(false);
  protected readonly confirmingClear = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly strategyOpen = signal(false);
  protected readonly profileOpen = signal(false);
  protected readonly calendarOpen = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');
  private readonly messagesList = viewChild.required<ElementRef<HTMLElement>>('messages');
  private stickToBottom = true;
  private lastStrategy = this.onboarding.strategy();
  private wasReviewing = this.onboarding.reviewing();

  constructor() {
    effect(() => {
      const reply = this.chat.lastReply();
      if (reply && untracked(() => this.settings.speakReplies())) {
        untracked(() => this.speech.speak(reply.id, reply.text));
      }
    });

    effect(() => {
      const strategy = this.onboarding.strategy();
      if (strategy && strategy !== this.lastStrategy) {
        untracked(() => {
          this.profileOpen.set(false);
          this.strategyOpen.set(true);
        });
      }
      this.lastStrategy = strategy;
    });

    effect(() => {
      const reviewing = this.onboarding.reviewing();
      if (reviewing && !this.wasReviewing) {
        untracked(() => this.profileOpen.set(true));
      }
      this.wasReviewing = reviewing;
    });

    afterRenderEffect(() => {
      this.chat.messages();
      this.stickToBottom = true;
      this.scrollToBottom('auto');
    });

    afterNextRender(() => {
      this.appUpdate.start();

      const viewport = window.visualViewport;
      if (viewport) {
        const syncViewport = () => {
          const style = document.documentElement.style;
          style.setProperty('--app-height', `${viewport.height}px`);
          style.setProperty('--app-top', `${viewport.offsetTop}px`);
          window.scrollTo(0, 0);
        };
        syncViewport();
        viewport.addEventListener('resize', syncViewport);
        viewport.addEventListener('scroll', syncViewport);
        this.destroyRef.onDestroy(() => {
          viewport.removeEventListener('resize', syncViewport);
          viewport.removeEventListener('scroll', syncViewport);
        });
      }

      const observer = new ResizeObserver(() => {
        if (this.stickToBottom) {
          this.scrollToBottom('auto');
        }
      });
      observer.observe(this.log().nativeElement);
      observer.observe(this.messagesList().nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected onLogScrolled(): void {
    const element = this.log().nativeElement;
    this.stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  }

  protected onStrategyClicked(): void {
    if (this.onboarding.confirmed()) {
      this.strategyOpen.set(true);
    } else {
      this.profileOpen.set(true);
    }
  }

  protected onClearClicked(): void {
    if (!this.confirmingClear()) {
      this.confirmingClear.set(true);
      setTimeout(() => this.confirmingClear.set(false), CLEAR_CONFIRM_TIMEOUT_MS);
      return;
    }
    this.speech.stopSpeaking();
    this.chat.clear();
    this.confirmingClear.set(false);
  }

  protected onDeleteRequested(id: string): void {
    if (this.speech.speakingId() === id) {
      this.speech.stopSpeaking();
    }
    this.chat.remove(id);
  }

  protected onSubmitted(payload: ComposerPayload): void {
    this.speech.stopSpeaking();
    this.chat.send(payload);
  }

  private scrollToBottom(behavior: ScrollBehavior): void {
    const element = this.log().nativeElement;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }
}
