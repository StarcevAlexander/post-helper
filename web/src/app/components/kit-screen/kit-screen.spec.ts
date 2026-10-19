import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_KIT_PATH,
  KITS_STORAGE_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  STRATEGY_STORAGE_KEY,
} from '../../constants';
import { PublicationKit, ScheduleDraft, Strategy } from '../../models';
import { Access } from '../../services/access';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { KitScreen } from './kit-screen';

const strategy: Strategy = {
  summary: 'Ок',
  positioning: 'Аккуратный маникюр',
  profileFixes: [],
  pillars: [
    { title: 'До и после', description: '', ideas: ['Кадр до'] },
    { title: 'Процесс', description: '', ideas: ['Видео'] },
    { title: 'Окошки', description: '', ideas: ['Свободно в пятницу'] },
  ],
  cadence: { reels: 1, posts: 1, stories: 1, note: '' },
  firstSteps: [],
};

const draft: ScheduleDraft = {
  weekday1: '3',
  time1: '18:00',
  weekday2: '',
  time2: '18:00',
  publishTime: '19:00',
};

const kit: PublicationKit = {
  shots: ['Снять руки крупно'],
  frames: [{ visual: 'Руки с гель-лаком', overlay: 'Смотрите' }],
  caption: 'Показываю маникюр.',
  hashtags: ['#маникюр', '#иркутск'],
  tip: 'Спросите согласие клиента',
};

describe('KitScreen', () => {
  let kits: Kits;
  let plan: CalendarPlan;
  let http: HttpTestingController;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    localStorage.clear();
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр' },
        confirmed: true,
      }),
    );
    localStorage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(strategy));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    kits = TestBed.inject(Kits);
    plan = TestBed.inject(CalendarPlan);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('secret-pass');
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function prepare() {
    const item = plan.items()[0];
    const pending = kits.generate(item);
    http.expectOne(`${API_DEV_URL}${API_KIT_PATH}`).flush(kit);
    await pending;
    const fixture = TestBed.createComponent(KitScreen);
    kits.view(item.id);
    await fixture.whenStable();
    return { item, fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows every part of the kit', async () => {
    const { element } = await prepare();

    const text = element.textContent ?? '';
    expect(text).toContain('Снять руки крупно');
    expect(text).toContain('Руки с гель-лаком');
    expect(text).toContain('Смотрите');
    expect(text).toContain('Показываю маникюр.');
    expect(text).toContain('#маникюр #иркутск');
    expect(text).toContain('Спросите согласие клиента');
    expect(element.querySelector('.screen__title')?.textContent).toContain(plan.items()[0].idea);
  });

  it('copies the caption with hashtags and confirms it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { fixture, element } = await prepare();

    element.querySelector<HTMLButtonElement>('.screen__primary')?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('Показываю маникюр.\n\n#маникюр #иркутск');
    expect(element.querySelector('.actions__feedback')?.textContent).toContain('Скопировано');
  });

  it('copies the whole kit', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { fixture, element } = await prepare();

    element.querySelectorAll<HTMLButtonElement>('.screen__secondary')[0].click();
    await fixture.whenStable();

    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied).toContain('Что снять:');
    expect(copied).toContain('Подпись:');
  });

  it('tells that copying failed', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    document.execCommand = vi.fn(() => false);
    const { fixture, element } = await prepare();

    element.querySelector<HTMLButtonElement>('.screen__primary')?.click();
    await vi.waitFor(() =>
      expect(element.querySelector('.actions__feedback')?.textContent).toContain('Не удалось'),
    );
    await fixture.whenStable();
  });

  it('asks for a new kit on demand', async () => {
    const { fixture, element, item } = await prepare();

    element.querySelectorAll<HTMLButtonElement>('.screen__secondary')[1].click();
    await fixture.whenStable();

    expect(kits.statusOf(item)).toBe('loading');
    http.expectOne(`${API_DEV_URL}${API_KIT_PATH}`).flush(kit);
    await vi.waitFor(() => expect(kits.statusOf(item)).toBe('ready'));
  });

  it('closes by clearing the viewed item', async () => {
    const { fixture, element } = await prepare();

    element.querySelector<HTMLButtonElement>('.screen__close')?.click();
    await fixture.whenStable();

    expect(kits.viewing()).toBeUndefined();
  });

  it('says so when the viewed kit no longer exists', async () => {
    const fixture = TestBed.createComponent(KitScreen);
    kits.view(plan.items()[0].id);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Комплект не найден');
    expect(localStorage.getItem(KITS_STORAGE_KEY)).toBeNull();
  });
});
