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
import {
  ACCOUNT_LABELS,
  ADMIN_MASTERS_TITLE,
  RETENTION_NOTE_FOR_MASTER,
  SYNC_STATUS_TEXT,
  APPEARANCE_TITLE,
  BACK_LABEL,
  ERROR_LOG_TITLE,
  REQUEST_LOG_TITLE,
  MAX_SCALE,
  MIN_SCALE,
  SCALE_SECTION_TITLE,
  SCALE_STEP,
  SETTINGS_CLOSE_LABEL,
  SETTINGS_TITLE,
  SPEAK_REPLIES_LABEL,
  THEME_SECTION_TITLE,
  THEMES,
} from '../../constants';
import { SettingsScreen, ThemeId } from '../../models';
import { Settings } from '../../services/settings';
import { Speech } from '../../services/speech';
import { Account } from '../../services/account';
import { formatRetention } from '../../utils/format-retention';
import { Sync } from '../../services/sync';
import { AdminMasters } from '../admin-masters/admin-masters';
import { ErrorLogScreen } from '../error-log/error-log';
import { RequestLogScreen } from '../request-log/request-log';

@Component({
  imports: [AdminMasters, ErrorLogScreen, RequestLogScreen],
  selector: 'app-settings-panel',
  styleUrl: './settings-panel.scss',
  templateUrl: './settings-panel.html',
})
export class SettingsPanel {
  protected readonly settings = inject(Settings);
  protected readonly speech = inject(Speech);
  protected readonly account = inject(Account);
  protected readonly sync = inject(Sync);
  protected readonly accountLabels = ACCOUNT_LABELS;
  protected readonly retentionNote = RETENTION_NOTE_FOR_MASTER;
  protected readonly retention = computed(() =>
    formatRetention(this.account.info()?.retentionDays ?? 0),
  );
  protected readonly mastersTitle = ADMIN_MASTERS_TITLE;
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
      case 'masters':
        return this.mastersTitle;
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
