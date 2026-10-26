import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_MEDIA_FILES_PATH } from '../../constants';
import { MediaResult, MediaStatus, PlanItem, PublicationKit } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { samplePlan } from '../../testing/plan-fixture';
import { ContentScreen } from './content-screen';

const kit: PublicationKit = {
  shots: [],
  frames: [{ visual: 'Руки', overlay: 'Смотрите' }],
  caption: 'Показываю маникюр.',
  hashtags: ['#маникюр', '#иркутск'],
  tip: '',
};

const result: MediaResult = {
  type: 'video/mp4',
  size: 9,
  width: 1080,
  height: 1920,
  durationMs: 14800,
  subtitled: true,
  thumb: false,
  note: 'Подровнял под 9:16, добавил тепла',
};

describe('ContentScreen', () => {
  let plan: CalendarPlan;
  let media: Media;
  let http: HttpTestingController;
  let item: PlanItem;

  beforeEach(() => {
    localStorage.clear();
    URL.createObjectURL = vi.fn(() => 'blob:media');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    plan = TestBed.inject(CalendarPlan);
    media = TestBed.inject(Media);
    http = TestBed.inject(HttpTestingController);
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    item = plan.weeks()[0].items[0];
  });

  afterEach(() => {
    media.stop();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  function status(overrides: Partial<MediaStatus> = {}): MediaStatus {
    return {
      id: 'a1',
      key: item.id,
      unit: '',
      kind: 'video',
      format: item.format,
      status: 'done',
      error: '',
      createdAt: '2026-10-26T10:00:00Z',
      source: { name: 'IMG_0001.MOV', type: 'video/quicktime', size: 100 },
      redos: 0,
      canRedo: false,
      result,
      ...overrides,
    };
  }

  async function render(id = item.id) {
    const fixture = TestBed.createComponent(ContentScreen);
    fixture.componentRef.setInput('id', id);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function flushFiles(): void {
    http
      .match((request) => request.url.startsWith(`${API_DEV_URL}${API_MEDIA_FILES_PATH}/`))
      .forEach((request) => request.flush(new Blob([new Uint8Array([1])])));
  }

  it('shows the publication, the hint and the capture block', async () => {
    const { element } = await render();

    expect(element.querySelector('.screen__title')?.textContent).toContain(item.idea);
    expect(element.querySelector('.screen__subtitle')?.textContent).toContain(item.pillar);
    expect(element.textContent).toContain(
      'Посмотрите, скачайте и опубликуйте сами. Подпись к публикации ниже.',
    );
    expect(element.querySelector('app-media-capture')).not.toBeNull();
  });

  it('says that nothing is shot yet and leads to the shoot list of the week', async () => {
    const { element } = await render();

    expect(element.textContent).toContain('Пока ничего не снято');
    const link = element.querySelector<HTMLAnchorElement>('.empty a')!;
    expect(link.getAttribute('href')).toBe('/shoot/0');
  });

  it('plays a finished video in its own proportions with a note and a download link', async () => {
    media.statuses.set([status()]);

    const { fixture, element } = await render();
    flushFiles();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('video')).not.toBeNull();
    });

    const video = element.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('blob:media');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(video.style.aspectRatio.replace(/\s/g, '')).toBe('1080/1920');
    expect(element.querySelector('.entry__note')?.textContent).toContain('добавил тепла');
    const download = element.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(download.getAttribute('download')).toBe(`${item.id}-1.mp4`);
    expect(download.getAttribute('href')).toBe('blob:media');
    expect(element.textContent).not.toContain('Сохранить в телефон');
  });

  it('shows a photo as a picture', async () => {
    media.statuses.set([
      status({
        kind: 'photo',
        result: { ...result, type: 'image/jpeg', width: 1080, height: 1350 },
      }),
    ]);

    const { fixture, element } = await render();
    flushFiles();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('img.entry__media')).not.toBeNull();
    });

    expect(element.querySelector('video')).toBeNull();
    expect(element.querySelector<HTMLAnchorElement>('a[download]')?.download).toBe(
      `${item.id}-1.jpg`,
    );
  });

  it('offers to save into the phone when the browser can share files', async () => {
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: vi.fn(() => true) });
    const save = vi.spyOn(media, 'save').mockResolvedValue('shared');
    media.statuses.set([status()]);

    const { fixture, element } = await render();
    flushFiles();
    await fixture.whenStable();
    const button = Array.from(element.querySelectorAll<HTMLButtonElement>('.entry__button')).find(
      (candidate) => candidate.textContent?.includes('Сохранить в телефон'),
    )!;
    button.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('.feedback')?.textContent).toContain('Файл сохранён');
    });

    expect(save).toHaveBeenCalledWith(media.statuses()[0]);
  });

  it('shows what is happening with the files that are not ready', async () => {
    media.statuses.set([
      status({ id: 'q', status: 'queued', result: undefined }),
      status({ id: 'r', status: 'running', result: undefined }),
      status({ id: 'f', status: 'failed', error: 'Сбой обработки', result: undefined }),
    ]);

    const { element } = await render();

    const states = Array.from(element.querySelectorAll('.entry__state')).map((state) =>
      state.textContent?.trim(),
    );
    expect(states).toEqual([
      'В очереди на обработку',
      'Обрабатываю',
      'Не получилось: Сбой обработки',
    ]);
    expect(element.querySelectorAll('[role="status"].entry__state').length).toBe(3);
    expect(element.textContent).not.toContain('Пока ничего не снято');
  });

  it('asks again before deleting and deletes only after the confirmation', async () => {
    const remove = vi.spyOn(media, 'remove').mockResolvedValue(true);
    media.statuses.set([status()]);
    const { fixture, element } = await render();
    flushFiles();
    await fixture.whenStable();
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.entry__button--danger')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.entry__confirm')?.textContent).toContain('насовсем');
    expect(remove).not.toHaveBeenCalled();

    element.querySelector<HTMLButtonElement>('.entry__confirm .entry__button')!.click();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledWith('a1');
    expect(element.querySelector('.entry__confirm')).toBeNull();
  });

  it('hides the download link when the phone can save the file itself', async () => {
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: vi.fn(() => true) });
    media.statuses.set([status()]);

    const { fixture, element } = await render();
    flushFiles();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.textContent).toContain('Сохранить в телефон');
    expect(element.querySelector('a[download]')).toBeNull();
  });

  it('offers to redo instead of deleting and sends the wish', async () => {
    const redo = vi.spyOn(media, 'redo').mockResolvedValue(true);
    media.statuses.set([status({ canRedo: true, redos: 1 })]);
    const { fixture, element } = await render();
    flushFiles();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.entry__actions .entry__button--danger')).toBeNull();
    const open = Array.from(element.querySelectorAll<HTMLButtonElement>('.entry__button')).find(
      (candidate) => candidate.textContent?.trim() === 'Переделать',
    )!;
    open.click();
    fixture.detectChanges();
    const input = element.querySelector<HTMLTextAreaElement>('.redo textarea')!;
    expect(element.querySelector('.redo')?.textContent).toContain('Переделать можно ещё раз: 2');
    input.value = 'Сделай ярче';
    input.dispatchEvent(new Event('input'));
    element.querySelector<HTMLButtonElement>('.redo .entry__button--primary')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('.redo')).toBeNull();
    });

    expect(redo).toHaveBeenCalledWith('a1', 'Сделай ярче');
  });

  it('still lets the master delete a file from the redo panel', async () => {
    const remove = vi.spyOn(media, 'remove').mockResolvedValue(true);
    media.statuses.set([status({ canRedo: true })]);
    const { fixture, element } = await render();
    flushFiles();
    await fixture.whenStable();
    fixture.detectChanges();

    Array.from(element.querySelectorAll<HTMLButtonElement>('.entry__button'))
      .find((candidate) => candidate.textContent?.trim() === 'Переделать')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.redo .entry__link')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.entry__confirm .entry__button')!.click();

    expect(remove).toHaveBeenCalledWith('a1');
  });

  it('tells that a redo is in progress and that a failed redo kept the old version', async () => {
    media.statuses.set([
      status({ id: 'q', status: 'queued', redos: 1, result: undefined }),
      status({ id: 'd', redos: 1, error: 'Сбой' }),
    ]);

    const { element } = await render();
    flushFiles();

    expect(element.querySelector('.entry__state')?.textContent).toContain(
      'Переделываю по вашему пожеланию',
    );
    expect(element.textContent).toContain('Переделать не получилось, осталась прежняя версия');
  });

  it('deletes a failed record at once', async () => {
    const remove = vi.spyOn(media, 'remove').mockResolvedValue(true);
    media.statuses.set([status({ status: 'failed', error: 'Сбой', result: undefined })]);
    const { element } = await render();

    element.querySelector<HTMLButtonElement>('.entry__button--danger')!.click();

    expect(remove).toHaveBeenCalledWith('a1');
  });

  it('copies the caption with the hashtags from the kit', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    TestBed.inject(Kits).stored.set({
      [item.id]: {
        itemId: item.id,
        format: item.format,
        pillar: item.pillar,
        idea: item.idea,
        kit,
      },
    });
    const { fixture, element } = await render();

    expect(element.querySelector('.caption__text')?.textContent).toContain('Показываю маникюр.');
    element.querySelector<HTMLButtonElement>('.caption__copy')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('.feedback')?.textContent).toContain('Текст скопирован');
    });

    expect(writeText).toHaveBeenCalledWith('Показываю маникюр.\n\n#маникюр #иркутск');
  });

  it('shows the sales text of the freshest finished file and copies it with the hashtags', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    TestBed.inject(Kits).stored.set({
      [item.id]: {
        itemId: item.id,
        format: item.format,
        pillar: item.pillar,
        idea: item.idea,
        kit,
      },
    });
    media.statuses.set([
      status({
        id: 'old',
        finishedAt: '2026-10-26T10:00:00Z',
        result: { ...result, caption: 'Старый текст' },
      }),
      status({
        id: 'new',
        finishedAt: '2026-10-26T12:00:00Z',
        result: { ...result, caption: 'Свежий продающий текст' },
      }),
      status({ id: 'none', finishedAt: '2026-10-26T13:00:00Z' }),
    ]);
    const { fixture, element } = await render();
    flushFiles();

    const sections = Array.from(element.querySelectorAll('.caption'));
    expect(sections[0].textContent).toContain('Текст для публикации');
    expect(sections[0].textContent).toContain('Свежий продающий текст');
    expect(sections[0].textContent).not.toContain('Старый текст');
    expect(sections[1].textContent).toContain('Подпись из комплекта');
    sections[0].querySelector<HTMLButtonElement>('.caption__copy')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('.feedback')?.textContent).toContain('Текст скопирован');
    });

    expect(writeText).toHaveBeenCalledWith('Свежий продающий текст\n\n#маникюр #иркутск');
  });

  it('has no sales text section when no file has one and keeps the master text field', async () => {
    media.statuses.set([status()]);

    const { element } = await render();
    flushFiles();

    expect(element.textContent).not.toContain('Текст для публикации');
    expect(element.querySelector('app-media-note textarea')).not.toBeNull();
  });
  it('says so when the publication is not in the plan', async () => {
    const { element } = await render('unknown');

    expect(element.textContent).toContain('Такой публикации в плане нет');
    expect(element.querySelector('app-media-capture')).toBeNull();
  });
});
