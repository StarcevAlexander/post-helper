import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField, maxLength } from '@angular/forms/signals';
import {
  ACCOUNT_LABELS,
  ACCOUNT_TEXTS,
  CLEAR_CONFIRM_TIMEOUT_MS,
  MAX_NAME_LENGTH,
  RETENTION_NOTE_FOR_MASTER,
  SYNC_STATUS_TEXT,
  APPEARANCE_TITLE,
  BACK_LABEL,
  ERROR_LOG_TITLE,
  REQUEST_LOG_TITLE,
  MAX_SCALE,
  MIN_SCALE,
  PUSH_TEXTS,
  SCALE_SECTION_TITLE,
  SCALE_STEP,
  SETTINGS_CLOSE_LABEL,
  SETTINGS_TITLE,
  SPEAK_REPLIES_LABEL,
  THEME_SECTION_TITLE,
  THEMES,
} from '../../constants';
import { ChatApiError, SettingsScreen, ThemeId } from '../../models';
import { Settings } from '../../services/settings';
import { Speech } from '../../services/speech';
import { Account } from '../../services/account';
import { PushNotifications } from '../../services/push-notifications';
import { Session } from '../../services/session';
import { TestNotification } from '../../services/test-notification';
import { formatRetention } from '../../utils/format-retention';
import { Sync } from '../../services/sync';
import { ErrorLogScreen } from '../error-log/error-log';
import { RequestLogScreen } from '../request-log/request-log';

@Component({
  imports: [ErrorLogScreen, FormField, RequestLogScreen],
  selector: 'app-settings-panel',
  styleUrl: './settings-panel.scss',
  templateUrl: './settings-panel.html',
})
export class SettingsPanel {
  protected readonly settings = inject(Settings);
  protected readonly speech = inject(Speech);
  protected readonly account = inject(Account);
  protected readonly sync = inject(Sync);
  protected readonly pushNotifications = inject(PushNotifications);
  protected readonly testNotification = inject(TestNotification);
  private readonly session = inject(Session);
  protected readonly pushTexts = PUSH_TEXTS;
  protected readonly accountLabels = ACCOUNT_LABELS;
  protected readonly accountTexts = ACCOUNT_TEXTS;
  protected readonly retentionNote = RETENTION_NOTE_FOR_MASTER;
  protected readonly retention = computed(() =>
    formatRetention(this.account.info()?.retentionDays ?? 0),
  );
  protected readonly syncText = computed(() => SYNC_STATUS_TEXT[this.sync.status()]);
  protected readonly title = SETTINGS_TITLE;
  protected readonly closeLabel = SETTINGS_CLOSE_LABEL;
  protected readonly speakRepliesLabel = SPEAK_REPLIES_LABEL;

  protected readonly appearanceTitle = APPEARANCE_TITLE;
  protected readonly themeTitle = THEME_SECTION_TITLE;
  protected readonly scaleTitle = SCALE_SECTION_TITLE;
  protected readonly backLabel = BACK_LABEL;
  protected readonly errorLogTitle = ERROR_LOG_TITLE;
  protected readonly requestLogTitle = REQUEST_LOG_TITLE;
  protected readonly themes = THEMES;
  protected readonly minScale = MIN_SCALE;
  protected readonly maxScale = MAX_SCALE;
  protected readonly scaleStep = SCALE_STEP;
  protected readonly screen = signal<SettingsScreen>('main');
  protected readonly nameModel = signal({ name: '' });
  protected readonly nameForm = form(this.nameModel, (path) => {
    maxLength(path.name, MAX_NAME_LENGTH);
  });
  protected readonly nameError = signal('');
  protected readonly renaming = signal(false);
  protected readonly confirmingLogout = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly logoutError = signal('');
  protected readonly logoutLabel = computed(() =>
    this.confirmingLogout() ? ACCOUNT_TEXTS.logoutConfirm : ACCOUNT_TEXTS.logout,
  );

  protected readonly currentThemeLabel = computed(
    () => this.themes.find((option) => option.id === this.settings.theme())?.label,
  );
  protected readonly heading = computed(() => {
    switch (this.screen()) {
      case 'appearance':
        return this.appearanceTitle;
      case 'theme':
        return this.themeTitle;
      case 'scale':
        return this.scaleTitle;
      case 'errors':
        return this.errorLogTitle;
      case 'requests':
        return this.requestLogTitle;
      case 'name':
        return ACCOUNT_TEXTS.rename;
      default:
        return this.title;
    }
  });

  readonly open = model(false);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (!this.open()) {
        this.screen.set('main');
        this.confirmingLogout.set(false);
        this.logoutError.set('');
      }
      if (this.open() && !element.open) {
        void this.account.refresh();
        element.showModal();
      } else if (!this.open() && element.open) {
        element.close();
      }
    });
  }

  protected onSpeakRepliesChanged(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.settings.setSpeakReplies(enabled);
    if (!enabled) {
      this.speech.stopSpeaking();
    }
  }

  protected onPushChanged(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    void (enabled ? this.pushNotifications.enable() : this.pushNotifications.disable());
  }

  protected onRenameOpened(): void {
    this.nameModel.set({ name: this.account.info()?.name ?? '' });
    this.nameError.set('');
    this.screen.set('name');
  }

  protected async onRenameSubmitted(): Promise<void> {
    const name = this.nameForm.name().value().trim();
    if (this.renaming()) {
      return;
    }
    if (!name) {
      this.nameError.set(ACCOUNT_TEXTS.emptyName);
      return;
    }
    if (this.nameForm.name().invalid()) {
      this.nameError.set(ACCOUNT_TEXTS.nameTooLong);
      return;
    }
    this.renaming.set(true);
    this.nameError.set('');
    try {
      await this.account.rename(name);
      this.screen.set('main');
    } catch (error) {
      this.nameError.set(
        error instanceof ChatApiError ? error.message : ACCOUNT_TEXTS.renameFailed,
      );
    } finally {
      this.renaming.set(false);
    }
  }

  protected async onLogoutClicked(): Promise<void> {
    if (this.loggingOut()) {
      return;
    }
    if (!this.confirmingLogout()) {
      this.confirmingLogout.set(true);
      this.logoutError.set('');
      setTimeout(() => this.confirmingLogout.set(false), CLEAR_CONFIRM_TIMEOUT_MS);
      return;
    }
    this.loggingOut.set(true);
    try {
      if (!(await this.session.logout())) {
        this.logoutError.set(ACCOUNT_TEXTS.logoutUnsaved);
      }
    } finally {
      this.confirmingLogout.set(false);
      this.loggingOut.set(false);
    }
  }

  protected onThemeChanged(id: ThemeId): void {
    this.settings.setTheme(id);
  }

  protected onScaleChanged(event: Event): void {
    this.settings.setScale(Number((event.target as HTMLInputElement).value));
  }

  protected onBackClicked(): void {
    this.screen.update((screen) =>
      screen === 'theme' || screen === 'scale' ? 'appearance' : 'main',
    );
  }

  protected onDialogClicked(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.open.set(false);
    }
  }
}
