import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_MEDIA_FILES_PATH } from '../../constants';
import { MediaStatus, PlanItem } from '../../models';
import { Media } from '../../services/media';
import { MediaCapture } from './media-capture';

const item: PlanItem = {
  id: 'w1-mon',
  date: '2026-10-26',
  time: '18:00',
  format: 'reels',
  pillar: 'Процесс',
  idea: 'Снятие гель-лака',
  done: false,
};

function status(overrides: Partial<MediaStatus> = {}): MediaStatus {
  return {
    id: 'a1',
    key: 'w1-mon',
    unit: 'w1-mon:frame:0',
    kind: 'video',
    format: 'reels',
    status: 'queued',
    error: '',
    createdAt: '2026-10-26T10:00:00Z',
    source: { name: 'IMG_0001.MOV', type: 'video/quicktime', size: 100 },
    redos: 0,
    canRedo: false,
    ...overrides,
  };
}

describe('MediaCapture', () => {
  let media: Media;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    URL.createObjectURL = vi.fn(() => 'blob:thumb');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    media = TestBed.inject(Media);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    media.stop();
    localStorage.clear();
  });

  async function render(unit = 'w1-mon:frame:0', overlay = 'Смотрите') {
    const fixture = TestBed.createComponent(MediaCapture);
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('unit', unit);
    fixture.componentRef.setInput('overlay', overlay);
    fixture.componentRef.setInput('note', 'Мой текст');
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('offers the camera and the gallery', async () => {
    const { element } = await render();

    const inputs = element.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs.length).toBe(2);
    expect(inputs[0].getAttribute('capture')).toBe('environment');
    expect(inputs[0].accept).toBe('image/*,video/*');
    expect(inputs[1].hasAttribute('capture')).toBe(false);
    expect(inputs[1].accept).toBe('image/*,video/*');
    const buttons = element.querySelectorAll('.capture__button');
    expect(buttons[0].textContent).toContain('Снять');
    expect(buttons[1].textContent).toContain('Из галереи');
  });

  it('passes the chosen file with the unit and the text on the frame to the upload', async () => {
    const upload = vi.spyOn(media, 'upload').mockResolvedValue(undefined);
    const { element } = await render();
    const file = new File([new Uint8Array([1])], 'IMG.jpg', { type: 'image/jpeg' });
    const input = element.querySelector<HTMLInputElement>('input[capture]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    expect(upload).toHaveBeenCalledWith(item, file, 'w1-mon:frame:0', 'Смотрите', 'Мой текст');
  });

  it('lists only the records of its own frame with their states', async () => {
    media.statuses.set([
      status({ id: 'q', status: 'queued' }),
      status({ id: 'r', status: 'running' }),
      status({ id: 'other', unit: 'w1-mon:frame:1', status: 'running' }),
      status({ id: 'bad', status: 'failed', error: 'Сбой' }),
    ]);

    const { element } = await render();

    const labels = Array.from(element.querySelectorAll('.tile__label')).map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual(['В очереди на обработку', 'Обрабатываю', 'Не получилось: Сбой']);
  });

  it('keeps the records without a frame apart from the frames', async () => {
    media.statuses.set([
      status({ id: 'whole', unit: '', status: 'running' }),
      status({ id: 'frame', status: 'queued' }),
    ]);

    const { element } = await render('', '');

    expect(element.querySelectorAll('.tile').length).toBe(1);
    expect(element.textContent).toContain('Обрабатываю');
  });

  it('shows the progress of an upload in progress', async () => {
    media.uploads.set([
      { id: 'u1', key: 'w1-mon', unit: 'w1-mon:frame:0', name: 'IMG.MOV', progress: 45 },
      { id: 'u2', key: 'w1-mon', unit: 'w1-mon:frame:1', name: 'IMG.MOV', progress: 10 },
    ]);

    const { element } = await render();

    expect(element.querySelectorAll('.tile').length).toBe(1);
    expect(element.querySelector('.tile__label')?.textContent).toContain('Загружаю 45 %');
    expect(element.querySelector('progress')?.value).toBe(45);
  });

  it('removes a failed record and dismisses a failed upload', async () => {
    const remove = vi.spyOn(media, 'remove').mockResolvedValue(true);
    media.statuses.set([status({ id: 'bad', status: 'failed', error: 'Сбой' })]);
    media.uploads.set([
      {
        id: 'u1',
        key: 'w1-mon',
        unit: 'w1-mon:frame:0',
        name: 'IMG.MOV',
        progress: 0,
        error: 'Нет связи',
      },
    ]);
    const { fixture, element } = await render();

    const buttons = element.querySelectorAll<HTMLButtonElement>('.tile__button');
    expect(buttons[0].textContent).toContain('Удалить');
    expect(buttons[1].textContent).toContain('Убрать');
    buttons[0].click();
    buttons[1].click();
    fixture.detectChanges();

    expect(remove).toHaveBeenCalledWith('bad');
    expect(media.uploads()).toEqual([]);
  });

  it('links a finished record to the finished content and shows its preview', async () => {
    media.statuses.set([
      status({
        status: 'done',
        result: {
          type: 'video/mp4',
          size: 9,
          width: 1080,
          height: 1920,
          durationMs: 1000,
          subtitled: true,
          thumb: true,
          note: 'ok',
        },
      }),
    ]);

    const { fixture, element } = await render();
    http
      .expectOne({ method: 'GET', url: `${API_DEV_URL}${API_MEDIA_FILES_PATH}/a1/thumb` })
      .flush(new Blob([new Uint8Array([1])]));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('img.tile__media')).not.toBeNull();
    });

    const link = element.querySelector<HTMLAnchorElement>('a.tile__button')!;
    expect(link.getAttribute('href')).toBe('/content/w1-mon');
    expect(link.textContent).toContain('Открыть');
    expect(element.querySelector('.tile__label')?.textContent).toContain('Готово');
  });

  it('can hide the stored records and keep only the uploads', async () => {
    media.statuses.set([status({ status: 'running', unit: '' })]);
    media.uploads.set([{ id: 'u1', key: 'w1-mon', unit: '', name: 'a', progress: 5 }]);
    const fixture = TestBed.createComponent(MediaCapture);
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('unit', '');
    fixture.componentRef.setInput('overlay', '');
    fixture.componentRef.setInput('listStored', false);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.tile').length).toBe(1);
    expect(element.textContent).toContain('Загружаю');
    expect(element.textContent).not.toContain('Обрабатываю');
  });
});
