import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SETTINGS_STORAGE_KEY, TUTORIAL_SLIDES, TUTORIAL_TEXTS } from '../../constants';
import { Navigation } from '../../services/navigation';
import { Settings } from '../../services/settings';
import { TutorialScreen } from './tutorial-screen';

describe('TutorialScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => localStorage.clear());

  async function render() {
    const fixture = TestBed.createComponent(TutorialScreen);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function press(element: HTMLElement, selector: string, text?: string): void {
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>(selector));
    (text ? buttons.find((button) => button.textContent?.includes(text)) : buttons[0])!.click();
  }

  it('starts with the purpose of the app and a way to skip', async () => {
    const { element } = await render();

    expect(element.querySelector('.slide__title')?.textContent).toContain('Для чего');
    expect(element.textContent).toContain(`${TUTORIAL_TEXTS.slideOf} 1 ${TUTORIAL_TEXTS.of} 6`);
    expect(element.textContent).toContain(TUTORIAL_TEXTS.skip);
    expect(element.querySelector<HTMLButtonElement>('.screen__secondary')?.disabled).toBe(true);
  });

  it('walks through the slides forward, back and by the dots', async () => {
    const { fixture, element } = await render();

    press(element, '.screen__primary');
    fixture.detectChanges();
    expect(element.querySelector('.slide__title')?.textContent).toContain('Что потребуется');

    press(element, '.screen__secondary');
    fixture.detectChanges();
    expect(element.querySelector('.slide__title')?.textContent).toContain('Для чего');

    element.querySelectorAll<HTMLButtonElement>('.dot')[3].click();
    fixture.detectChanges();
    expect(element.querySelector('.slide__title')?.textContent).toContain('Шаг 2');
  });

  it('explains the Instagram note on the slide with the requirements', async () => {
    const { fixture, element } = await render();

    press(element, '.screen__primary');
    fixture.detectChanges();

    expect(element.textContent).toContain('Instagram*');
    expect(element.textContent).toContain('Meta');
  });

  it('remembers that the tutorial was skipped', async () => {
    const { element } = await render();
    const go = vi.spyOn(TestBed.inject(Navigation), 'go').mockImplementation(() => undefined);

    press(element, '.skip');

    expect(TestBed.inject(Settings).tutorialSeen()).toBe(true);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({
      tutorialSeen: true,
    });
    expect(go).toHaveBeenCalledWith('/');
  });

  it('finishes on the last slide and hides the skip button there', async () => {
    const { fixture, element } = await render();
    const go = vi.spyOn(TestBed.inject(Navigation), 'go').mockImplementation(() => undefined);

    for (let step = 1; step < TUTORIAL_SLIDES.length; step += 1) {
      press(element, '.screen__primary');
      fixture.detectChanges();
    }

    expect(element.querySelector('.skip')).toBeNull();
    expect(element.querySelector('.screen__primary')?.textContent).toContain(TUTORIAL_TEXTS.start);
    press(element, '.screen__primary');

    expect(go).toHaveBeenCalledWith('/');
    expect(TestBed.inject(Settings).tutorialSeen()).toBe(true);
  });
});
