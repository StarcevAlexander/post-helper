import { Component, computed, inject, signal } from '@angular/core';
import { TUTORIAL_SLIDES, TUTORIAL_TEXTS } from '../../constants';
import { Navigation } from '../../services/navigation';
import { Settings } from '../../services/settings';

@Component({
  selector: 'app-tutorial-screen',
  styleUrl: './tutorial-screen.scss',
  templateUrl: './tutorial-screen.html',
})
export class TutorialScreen {
  private readonly settings = inject(Settings);
  private readonly navigation = inject(Navigation);

  protected readonly texts = TUTORIAL_TEXTS;
  protected readonly slides = TUTORIAL_SLIDES;
  protected readonly index = signal(0);
  protected readonly slide = computed(() => this.slides[this.index()]);
  protected readonly first = computed(() => this.index() === 0);
  protected readonly last = computed(() => this.index() === this.slides.length - 1);

  protected next(): void {
    if (this.last()) {
      this.finish();
      return;
    }
    this.index.update((value) => value + 1);
  }

  protected previous(): void {
    this.index.update((value) => Math.max(0, value - 1));
  }

  protected goTo(index: number): void {
    this.index.set(index);
  }

  protected finish(): void {
    this.settings.markTutorialSeen();
    this.navigation.go('/');
  }
}
