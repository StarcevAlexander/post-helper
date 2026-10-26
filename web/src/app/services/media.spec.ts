import { HttpEventType } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_MEDIA_FILES_PATH,
  API_MEDIA_ITEMS_PATH,
  API_MEDIA_STATUS_PATH,
  API_MEDIA_UPLOAD_PATH,
  MEDIA_MAX_BYTES,
  MEDIA_POLL_MS,
} from '../constants';
import { MediaStatus, MediaUploadMeta, PlanItem } from '../models';
import { Access } from './access';
import { Media } from './media';

const statusUrl = `${API_DEV_URL}${API_MEDIA_STATUS_PATH}`;
const uploadUrl = `${API_DEV_URL}${API_MEDIA_UPLOAD_PATH}`;
const itemUrl = (id: string) => `${API_DEV_URL}${API_MEDIA_ITEMS_PATH}/${id}`;
const fileUrl = (id: string) => `${API_DEV_URL}${API_MEDIA_FILES_PATH}/${id}`;
const meUrl = `${API_DEV_URL}/api/me`;

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
    ...overrides,
  };
}

function doneStatus(overrides: Partial<MediaStatus> = {}): MediaStatus {
  return status({
    status: 'done',
    finishedAt: '2026-10-26T10:03:00Z',
    result: {
      type: 'video/mp4',
      size: 90,
      width: 1080,
      height: 1920,
      durationMs: 14800,
      subtitled: true,
      thumb: true,
      note: 'Подровнял под 9:16',
    },
    ...overrides,
  });
}

describe('Media', () => {
  let media: Media;
  let http: HttpTestingController;

  async function signIn(): Promise<void> {
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    TestBed.tick();
    http.expectOne({ method: 'GET', url: meUrl }).flush({ name: 'Анна', retentionDays: 1095 });
    await vi.waitFor(() => {
      TestBed.tick();
    });
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    media = TestBed.inject(Media);
  });

  afterEach(() => {
    media.stop();
    http.verify();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads the statuses once the master is known', async () => {
    await signIn();

    http.expectOne({ method: 'GET', url: statusUrl }).flush([status()]);
    await vi.advanceTimersByTimeAsync(0);

    expect(media.statuses().length).toBe(1);
    expect(media.active()).toBe(true);
  });

  it('groups the statuses by publication and counts the finished ones', async () => {
    const pending = media.refresh();
    http
      .expectOne({ method: 'GET', url: statusUrl })
      .flush([
        doneStatus(),
        status({ id: 'a2', status: 'running' }),
        status({ id: 'b1', key: 'w1-wed', status: 'done' }),
      ]);
    await pending;

    expect(media.byKey().get('w1-mon')?.length).toBe(2);
    expect(media.contentLabel('w1-mon')).toBe('Готовый контент (1)');
    expect(media.contentLabel('w1-fri')).toBeUndefined();
    expect(media.contentPending('w1-mon')).toBe(true);
    expect(media.contentPending('w1-wed')).toBe(false);
  });

  it('asks again while something is being processed and stops when it is done', async () => {
    const first = media.refresh();
    http.expectOne({ method: 'GET', url: statusUrl }).flush([status({ status: 'running' })]);
    await first;

    await vi.advanceTimersByTimeAsync(MEDIA_POLL_MS);
    http.expectOne({ method: 'GET', url: statusUrl }).flush([doneStatus()]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MEDIA_POLL_MS * 3);

    expect(media.active()).toBe(false);
  });

  it('uploads the file with the description, shows the progress and keeps the answer', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'IMG_0001.MOV', { type: 'video/quicktime' });

    const pending = media.upload(item, file, 'w1-mon:frame:0', 'Смотрите');
    const request = http.expectOne({ method: 'POST', url: uploadUrl });
    const form = request.request.body as FormData;
    const meta = JSON.parse(form.get('data') as string) as MediaUploadMeta;
    expect(meta).toEqual({
      key: 'w1-mon',
      unit: 'w1-mon:frame:0',
      format: 'reels',
      pillar: 'Процесс',
      idea: 'Снятие гель-лака',
      overlay: 'Смотрите',
    });
    expect((form.get('file') as File).name).toBe('IMG_0001.MOV');
    expect(request.request.headers.get('Authorization')).toMatch(/^Bearer /);
    expect(media.active()).toBe(true);

    request.event({ type: HttpEventType.UploadProgress, loaded: 45, total: 100 });
    expect(media.uploads()[0].progress).toBe(45);

    request.flush(status());
    await pending;

    expect(media.uploads()).toEqual([]);
    expect(media.statuses().map((entry) => entry.id)).toEqual(['a1']);
  });

  it('refuses a file over the limit without sending it', async () => {
    const file = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: MEDIA_MAX_BYTES + 1 });

    await media.upload(item, file, '', '');

    http.expectNone(uploadUrl);
    expect(media.uploads()[0].error).toContain('300 МБ');
    expect(media.active()).toBe(false);
  });

  it('keeps the upload with the server message when the server refuses it', async () => {
    const file = new File(['x'], 'IMG.jpg', { type: 'image/jpeg' });

    const pending = media.upload(item, file, '', '');
    http
      .expectOne({ method: 'POST', url: uploadUrl })
      .flush(
        { error: 'Слишком много загрузок: удалите ненужное в готовом контенте' },
        { status: 409, statusText: 'Conflict' },
      );
    await pending;

    const [upload] = media.uploads();
    expect(upload.error).toBe('Слишком много загрузок: удалите ненужное в готовом контенте');
    media.dismissUpload(upload.id);
    expect(media.uploads()).toEqual([]);
  });

  it('deletes a record on the server and forgets it', async () => {
    const loaded = media.refresh();
    http
      .expectOne({ method: 'GET', url: statusUrl })
      .flush([doneStatus(), doneStatus({ id: 'a2' })]);
    await loaded;

    const pending = media.remove('a1');
    http.expectOne({ method: 'DELETE', url: itemUrl('a1') }).flush({ ok: true });

    expect(await pending).toBe(true);
    expect(media.statuses().map((entry) => entry.id)).toEqual(['a2']);
  });

  it('loads a file once and keeps its address, the poster comes from its own path', async () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:media'), revokeObjectURL: vi.fn() }),
    );
    const done = doneStatus();

    const first = media.urlFor(done);
    const second = media.urlFor(done);
    http.expectOne({ method: 'GET', url: fileUrl('a1') }).flush(new Blob([new Uint8Array([1])]));
    const poster = media.thumbUrlFor(done);
    http
      .expectOne({ method: 'GET', url: `${fileUrl('a1')}/thumb` })
      .flush(new Blob([new Uint8Array([1])]));

    expect(await first).toBe('blob:media');
    expect(await second).toBe('blob:media');
    expect(await poster).toBe('blob:media');
  });

  it('names the files after the publication and their order', async () => {
    const loaded = media.refresh();
    http.expectOne({ method: 'GET', url: statusUrl }).flush([
      doneStatus(),
      doneStatus({
        id: 'a2',
        kind: 'photo',
        result: { ...doneStatus().result!, type: 'image/jpeg' },
      }),
    ]);
    await loaded;

    expect(media.fileNameFor(media.statuses()[0])).toBe('w1-mon-1.mp4');
    expect(media.fileNameFor(media.statuses()[1])).toBe('w1-mon-2.jpg');
  });

  it('shares the file when the phone can share files', async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const done = doneStatus();
    const pending = media.save(done);
    http.expectOne({ method: 'GET', url: fileUrl('a1') }).flush(new Blob([new Uint8Array([1])]));

    expect(await pending).toBe('shared');
    const shared = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0];
    expect(shared.name).toBe('w1-mon-1.mp4');
    expect(shared.type).toBe('video/mp4');
  });

  it('does not download anything when the master closes the share sheet', async () => {
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: vi.fn(async () => {
        throw new DOMException('closed', 'AbortError');
      }),
    });
    const pending = media.save(doneStatus());
    http.expectOne({ method: 'GET', url: fileUrl('a1') }).flush(new Blob([new Uint8Array([1])]));

    expect(await pending).toBe('cancelled');
  });

  it('falls back to a download link when sharing files is not possible', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:media'), revokeObjectURL: vi.fn() }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const pending = media.save(doneStatus());
    http.expectOne({ method: 'GET', url: fileUrl('a1') }).flush(new Blob([new Uint8Array([1])]));

    expect(await pending).toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
  it('sends the master text with the upload and keeps it per publication', async () => {
    media.setNote('w1-mon', 'Свободно в пятницу, маникюр со скидкой');
    expect(JSON.parse(localStorage.getItem('helper.media-notes')!)).toEqual({
      'w1-mon': 'Свободно в пятницу, маникюр со скидкой',
    });

    const file = new File(['x'], 'IMG.jpg', { type: 'image/jpeg' });
    const pending = media.upload(item, file, '', '', media.noteFor('w1-mon'));
    const request = http.expectOne({ method: 'POST', url: uploadUrl });
    const meta = JSON.parse((request.request.body as FormData).get('data') as string);
    expect(meta.note).toBe('Свободно в пятницу, маникюр со скидкой');
    request.flush(status());
    await pending;

    media.setNote('w1-mon', '');
    expect(media.noteFor('w1-mon')).toBe('');
    expect(JSON.parse(localStorage.getItem('helper.media-notes')!)).toEqual({});
  });

  it('cuts the text to the limit and restores it after a restart', () => {
    media.setNote('w1-mon', 'я'.repeat(1200));
    expect(media.noteFor('w1-mon').length).toBe(1000);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const again = TestBed.inject(Media);

    expect(again.noteFor('w1-mon').length).toBe(1000);
    again.stop();
  });
});
