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
import { ReviewScreen } from './components/review-screen/review-screen';
import { KitScreen } from './components/kit-screen/kit-screen';
import { RefsScreen } from './components/refs-screen/refs-screen';
import { MessageBubble } from './components/message-bubble/message-bubble';
import { SettingsPanel } from './components/settings-panel/settings-panel';
import { AuditScreen } from './components/audit-screen/audit-screen';
import { CalendarScreen } from './components/calendar-screen/calendar-screen';
import { IntakeScreen } from './components/intake-screen/intake-screen';
import { ProfileScreen } from './components/profile-screen/profile-screen';
import { StrategyScreen } from './components/strategy-screen/strategy-screen';
import { TodayScreen } from './components/today-screen/today-screen';
import {
  CLEAR_CONFIRM_TIMEOUT_MS,
  HISTORY_CONTEXT_LABEL,
  NOTIFY_BUTTON_LABEL,
  NOTIFY_WAITING_LABEL,
  CALENDAR_OPEN_LABEL,
  INTAKE_TEXTS,
  SETTINGS_OPEN_LABEL,
  STRATEGY_OPEN_LABEL,
  TODAY_OPEN_LABEL,
  UPDATE_BUTTON_LABEL,
} from './constants';
import { ComposerPayload } from './models';
import { Access } from './services/access';
import { Account } from './services/account';
import { CalendarPlan } from './services/calendar-plan';
import { Intake } from './services/intake';
import { AppUpdate } from './services/app-update';
import { Chat } from './services/chat';
import { Kits } from './services/kits';
import { Reviews } from './services/reviews';
import { Audit } from './services/audit';
import { AuditJobs } from './services/audit-jobs';
import { Onboarding } from './services/onboarding';
import { Settings } from './services/settings';
import { Sync } from './services/sync';
import { Speech } from './services/speech';
import { Today } from './services/today';
import { TestNotification } from './services/test-notification';
import { APP_VERSION } from './version';

@Component({
  imports: [
    AccessGate,
    AuditScreen,
    CalendarScreen,
    Composer,
    IntakeScreen,
    KitScreen,
    RefsScreen,
    MessageBubble,
    ProfileScreen,
    ReviewScreen,
    SettingsPanel,
    StrategyScreen,
    TodayScreen,
  ],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly access = inject(Access);
  protected readonly account = inject(Account);
  protected readonly intake = inject(Intake);
  protected readonly chat = inject(Chat);
  protected readonly speech = inject(Speech);
  protected readonly settings = inject(Settings);
  protected readonly onboarding = inject(Onboarding);
  protected readonly sync = inject(Sync);
  protected readonly plan = inject(CalendarPlan);
  protected readonly today = inject(Today);
  private readonly kits = inject(Kits);
  private readonly reviews = inject(Reviews);
  private readonly audit = inject(Audit);
  private readonly auditJobs = inject(AuditJobs);
  protected readonly appUpdate = inject(AppUpdate);
  protected readonly testNotification = inject(TestNotification);
  protected readonly notifyLabel = NOTIFY_BUTTON_LABEL;
  protected readonly notifyWaitingLabel = NOTIFY_WAITING_LABEL;
  protected readonly settingsOpenLabel = SETTINGS_OPEN_LABEL;
  protected readonly strategyOpenLabel = STRATEGY_OPEN_LABEL;
  protected readonly calendarOpenLabel = CALENDAR_OPEN_LABEL;
  protected readonly todayOpenLabel = TODAY_OPEN_LABEL;
  protected readonly updateLabel = UPDATE_BUTTON_LABEL;
  protected readonly intakeOpenLabel = INTAKE_TEXTS.open;
  protected readonly contextLabel = HISTORY_CONTEXT_LABEL;
  protected readonly version = APP_VERSION;
  protected readonly composing = signal(false);
  protected readonly draftActive = signal(false);
  protected readonly confirmingClear = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly strategyOpen = signal(false);
  protected readonly profileOpen = signal(false);
  protected readonly calendarOpen = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');
  private readonly messagesList = viewChild.required<ElementRef<HTMLElement>>('messages');
  private stickToBottom = true;
  private lastRevision = this.onboarding.strategyRevision();
  private wasReviewing = this.onboarding.reviewing();

  constructor() {
    effect(() => {
      const reply = this.chat.lastReply();
      if (reply && untracked(() => this.settings.speakReplies())) {
        untracked(() => this.speech.speak(reply.id, reply.text));
      }
    });

    effect(() => {
      const revision = this.onboarding.strategyRevision();
      if (revision !== this.lastRevision && untracked(() => this.onboarding.strategy())) {
        untracked(() => {
          this.profileOpen.set(false);
          this.strategyOpen.set(true);
        });
      }
      this.lastRevision = revision;
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
      if (this.access.granted()) {
        void this.auditJobs.refresh();
      }
      this.today.openFromLink();
      this.appUpdate.setIdleCheck(() => this.isIdle());
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

  private isIdle(): boolean {
    return (
      !this.chat.busy() &&
      !this.speech.listening() &&
      !this.draftActive() &&
      this.kits.batch() === undefined &&
      !Object.values(this.kits.progress()).includes('loading') &&
      !this.reviews.busy() &&
      !this.audit.busy() &&
      !this.intake.busy() &&
      this.sync.status() !== 'syncing' &&
      document.querySelector('dialog[open]') === null
    );
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
