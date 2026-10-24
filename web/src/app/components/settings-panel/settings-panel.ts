import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, maxLength } from '@angular/forms/signals';
import {
  ACCOUNT_LABELS,
  ACCOUNT_TEXTS,
  CLEAR_CONFIRM_TIMEOUT_MS,
  MAX_NAME_LENGTH,
  YANDEX_TEXTS,
  RETENTION_NOTE_FOR_MASTER,
  SYNC_STATUS_TEXT,
  FAQ_TEXTS,
  FEEDBACK_TEXTS,
  TUTORIAL_TEXTS,
  APPEARANCE_TITLE,
  MAX_SCALE,
  MIN_SCALE,
  PUSH_TEXTS,
  SCALE_SECTION_TITLE,
  SCALE_STEP,
  THEME_SECTION_TITLE,
  THEMES,
} from '../../constants';
import { ChatApiError, SettingsScreen, ThemeId } from '../../models';
import { Navigation } from '../../services/navigation';
import { Settings } from '../../services/settings';
import { Account } from '../../services/account';
import { PushNotifications } from '../../services/push-notifications';
import { Session } from '../../services/session';
import { TestNotification } from '../../services/test-notification';
import { YandexAuth } from '../../services/yandex-auth';
import { formatRetention } from '../../utils/format-retention';
import { Sync } from '../../services/sync';

@Component({
  imports: [FormField, RouterLink],
  selector: 'app-settings-panel',
  styleUrl: './settings-panel.scss',
  templateUrl: './settings-panel.html',
})
export class SettingsPanel {
  readonly section = input<SettingsScreen>();

  private readonly navigation = inject(Navigation);
  protected readonly settings = inject(Settings);
  protected readonly account = inject(Account);
  protected readonly sync = inject(Sync);
  protected readonly pushNotifications = inject(PushNotifications);
  protected readonly testNotification = inject(TestNotification);
  private readonly session = inject(Session);
  protected readonly yandex = inject(YandexAuth);
  protected readonly yandexTexts = YANDEX_TEXTS;
  protected readonly logoutHint = computed(() =>
    this.yandex.available() ? YANDEX_TEXTS.logoutHint : ACCOUNT_TEXTS.logoutHint,
  );
  protected readonly pushTexts = PUSH_TEXTS;
  protected readonly accountLabels = ACCOUNT_LABELS;
  protected readonly accountTexts = ACCOUNT_TEXTS;
  protected readonly retentionNote = RETENTION_NOTE_FOR_MASTER;
  protected readonly retention = computed(() =>
    formatRetention(this.account.info()?.retentionDays ?? 0),
  );
  protected readonly syncText = computed(() => SYNC_STATUS_TEXT[this.sync.status()]);

  protected readonly appearanceTitle = APPEARANCE_TITLE;
  protected readonly tutorialTitle = TUTORIAL_TEXTS.open;
  protected readonly faqTitle = FAQ_TEXTS.open;
  protected readonly feedbackTitle = FEEDBACK_TEXTS.open;
  protected readonly themeTitle = THEME_SECTION_TITLE;
  protected readonly scaleTitle = SCALE_SECTION_TITLE;
  protected readonly themes = THEMES;
  protected readonly minScale = MIN_SCALE;
  protected readonly maxScale = MAX_SCALE;
  protected readonly scaleStep = SCALE_STEP;
  protected readonly screen = computed<SettingsScreen>(() => this.section() ?? 'main');
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

  constructor() {
    void this.account.refresh();

    effect(() => {
      if (this.screen() === 'name') {
        const name = this.account.info()?.name ?? '';
        untracked(() => {
          if (this.nameModel().name === '') {
            this.nameModel.set({ name });
          }
        });
      }
    });
  }

  protected onPushChanged(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    void (enabled ? this.pushNotifications.enable() : this.pushNotifications.disable());
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
      this.navigation.back();
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
}
