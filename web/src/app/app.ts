import { Component, DestroyRef, afterNextRender, effect, inject, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AccessGate } from './components/access-gate/access-gate';
import {
  NAV_TABS,
  NAV_TEXTS,
  SETTINGS_OPEN_LABEL,
  UPDATE_BUTTON_LABEL,
  UPDATE_TEXTS,
} from './constants';
import { Access } from './services/access';
import { Account } from './services/account';
import { AppUpdate } from './services/app-update';
import { Intake } from './services/intake';
import { Navigation } from './services/navigation';
import { Settings } from './services/settings';
import { Sync } from './services/sync';
import { Today } from './services/today';
import { YandexAuth } from './services/yandex-auth';
import { APP_VERSION } from './version';

@Component({
  imports: [AccessGate, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly access = inject(Access);
  protected readonly navigation = inject(Navigation);
  protected readonly appUpdate = inject(AppUpdate);
  private readonly account = inject(Account);
  private readonly settings = inject(Settings);
  private readonly intake = inject(Intake);
  private readonly sync = inject(Sync);
  private readonly today = inject(Today);
  private readonly yandexAuth = inject(YandexAuth);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly texts = NAV_TEXTS;
  protected readonly tabs = NAV_TABS;
  protected readonly settingsOpenLabel = SETTINGS_OPEN_LABEL;
  protected readonly updateLabel = UPDATE_BUTTON_LABEL;
  protected readonly updateTexts = UPDATE_TEXTS;
  protected readonly version = APP_VERSION;

  private tutorialOpened = false;

  constructor() {
    effect(() => {
      const ready =
        this.access.granted() &&
        this.account.signedIn() &&
        this.sync.status() === 'ok' &&
        !this.settings.tutorialSeen();
      if (ready && !this.tutorialOpened) {
        this.tutorialOpened = true;
        untracked(() => this.navigation.go('/tutorial'));
      }
    });

    afterNextRender(() => {
      void this.yandexAuth.loadConfig();
      void this.yandexAuth.completeFromUrl();
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
    });
  }

  private isIdle(): boolean {
    return (
      !this.intake.busy() &&
      this.sync.status() !== 'syncing' &&
      document.querySelector('dialog[open]') === null
    );
  }
}
