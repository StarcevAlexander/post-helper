import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_REFS_FILES_PATH,
  API_REFS_MADE_PATH,
  API_REFS_STATUS_PATH,
  CALENDAR_STORAGE_KEY,
} from '../../constants';
import { RefFileMeta, RefStatus, StoredCalendar } from '../../models';
import { Access } from '../../services/access';
import { Refs } from '../../services/refs';
import { RefsScreen } from './refs-screen';

const madeUrl = `${API_DEV_URL}${API_REFS_MADE_PATH}`;
const statusUrl = `${API_DEV_URL}${API_REFS_STATUS_PATH}`;
const fileUrl = (id: string) => `${API_DEV_URL}${API_REFS_FILES_PATH}/${id}`;

const calendar: StoredCalendar = {
  schedule: { slots: [{ weekday: 1, time: '12:00' }], publishTime: '18:00' },
  startedOn: '2026-10-20',
  items: [
    {
      id: 'w1-mon',
      date: '2026-10-20',
      time: '18:00',
      format: 'reels',
      pillar: 'Процесс',
      idea: 'Видео снятия гель-лака',
      done: false,
    },
  ],
};

function file(index: number, kind: 'photo' | 'video' = 'photo'): RefFileMeta {
  return {
    id: `f${index}`,
    index,
    kind,
    mediaType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
    caption: `Кадр ${index + 1}`,
    size: 10,
  };
}

function status(overrides: Partial<RefStatus> = {}): RefStatus {
  return { key: 'w1-mon', status: 'done', kind: 'photo', stale: false, files: [], ...overrides };
}

function button(element: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
    candidate.textContent?.trim().includes(label),
  );
}

describe('RefsScreen', () => {
  let refs: Refs;
  let http: HttpTestingController;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    URL.createObjectURL = vi.fn(() => 'blob:ref');
    URL.revokeObjectURL = vi.fn();
    localStorage.clear();
    localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendar));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    refs = TestBed.inject(Refs);
  });

  afterEach(() => {
    refs.stop();
    localStorage.clear();
  });

  async function open(current: RefStatus) {
    const fixture = TestBed.createComponent(RefsScreen);
    refs.statuses.set([current]);
    refs.view('w1-mon');
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the three references with their captions', async () => {
    const files = [file(0), file(1), file(2)];
    const { fixture, element } = await open(status({ files }));
    for (const meta of files) {
      http
        .expectOne({ method: 'GET', url: fileUrl(meta.id) })
        .flush(new Blob([new Uint8Array([1])]));
    }
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelectorAll('img.tile__media').length).toBe(3);
    });

    const text = element.textContent ?? '';
    expect(text).toContain('Видео снятия гель-лака');
    expect(text).toContain('Кадр 1');
    expect(text).toContain('Кадр 3');
    expect(element.querySelector('video')).toBeNull();
  });

  it('plays video references without sound', async () => {
    const { fixture, element } = await open(status({ kind: 'video', files: [file(0, 'video')] }));
    http.expectOne({ method: 'GET', url: fileUrl('f0') }).flush(new Blob([new Uint8Array([1])]));

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('video.tile__media')).toBeTruthy();
    });

    const video = element.querySelector('video') as HTMLVideoElement;
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.hasAttribute('controls')).toBe(true);
  });

  it('says that the references are still being made and lets confirm anyway', async () => {
    const { element } = await open(status({ status: 'queued' }));

    expect(element.textContent).toContain('ещё готовятся');
    expect(button(element, 'Контент изготовлен')).toBeTruthy();
  });

  it('does not offer the confirmation while the references are being made right now', async () => {
    const { element } = await open(status({ status: 'running' }));

    expect(button(element, 'Контент изготовлен')).toBeUndefined();
  });

  it('asks twice: nothing happens on cancel', async () => {
    const { fixture, element } = await open(status());

    button(element, 'Контент изготовлен')?.click();
    fixture.detectChanges();
    const confirm = element.querySelector<HTMLDialogElement>('dialog.confirm');
    expect(confirm?.hasAttribute('open')).toBe(true);
    expect(confirm?.textContent).toContain('удалены');
    button(element, 'Отмена')?.click();
    fixture.detectChanges();

    expect(confirm?.hasAttribute('open')).toBe(false);
    http.expectNone({ method: 'POST', url: madeUrl });
  });

  it('deletes the references after OK and closes the window', async () => {
    const { fixture, element } = await open(status());
    button(element, 'Контент изготовлен')?.click();
    fixture.detectChanges();

    button(element, 'ОК')?.click();
    const request = http.expectOne({ method: 'POST', url: madeUrl });
    expect(request.request.body).toEqual({ key: 'w1-mon' });
    request.flush({ ok: true });
    await vi.waitFor(() =>
      http.expectOne({ method: 'GET', url: statusUrl }).flush([status({ status: 'made' })]),
    );
    await vi.waitFor(() => expect(refs.viewing()).toBeUndefined());
  });

  it('shows the confirmed state without the button', async () => {
    const { element } = await open(status({ status: 'made' }));

    expect(element.textContent).toContain('Контент изготовлен');
    expect(element.querySelector('.screen__primary:not(.confirm .screen__primary)')).toBeNull();
  });
});
