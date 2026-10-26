import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_REFS_FILES_PATH } from '../../constants';
import { PublicationKit, RefStatus } from '../../models';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { Refs } from '../../services/refs';
import { ShootScreen } from './shoot-screen';

const kit: PublicationKit = {
  shots: ['Руки крупно на светлом фоне'],
  frames: [{ visual: 'Руки с гель-лаком', overlay: 'Смотрите' }],
  caption: 'Подпись',
  hashtags: [],
  tip: '',
};

const description = 'Снимайте сверху при мягком окне, на столе только флакон и кисть.';

describe('ShootScreen', () => {
  let plan: CalendarPlan;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    URL.createObjectURL = vi.fn(() => 'blob:ref');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    plan = TestBed.inject(CalendarPlan);
    http = TestBed.inject(HttpTestingController);
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
  });

  afterEach(() => {
    TestBed.inject(Refs).stop();
    localStorage.clear();
  });

  function status(key: string, overrides: Partial<RefStatus> = {}): RefStatus {
    return { key, status: 'queued', kind: 'photo', stale: false, files: [], ...overrides };
  }

  async function render(week = '0') {
    const fixture = TestBed.createComponent(ShootScreen);
    fixture.componentRef.setInput('week', week);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('lists every publication of the week with the heading and the content days', async () => {
    const { element } = await render();

    expect(element.querySelector('.screen__title')?.textContent).toContain('Неделя 1');
    expect(element.querySelectorAll('.screen__chip').length).toBe(1);
    expect(element.querySelectorAll('.entry').length).toBe(plan.weeks()[0].items.length);
  });

  it('shows what to shoot from the kit and says when the kit is still to come', async () => {
    const first = [...plan.weeks()[0].items].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    TestBed.inject(Kits).stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit,
      },
    });

    const { element } = await render();

    const entries = element.querySelectorAll('.entry');
    expect(entries[0].textContent).toContain('Руки с гель-лаком');
    expect(entries[0].textContent).toContain('Смотрите');
    expect(entries[1].textContent).toContain('Подробный список кадров скоро появится');
  });

  it('groups the shoot by activity: the readiness mark first, then every frame with its reference under it', async () => {
    const first = [...plan.weeks()[0].items].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    TestBed.inject(Kits).stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit,
      },
    });
    TestBed.inject(Refs).statuses.set([
      status(first.id, {
        status: 'done',
        files: [
          {
            id: 'a',
            index: 0,
            kind: 'photo',
            mediaType: 'image/jpeg',
            caption: description,
            size: 1,
          },
          { id: 'b', index: 1, kind: 'photo', mediaType: 'image/jpeg', caption: 'Лишний', size: 1 },
        ],
      }),
    ]);
    const { fixture, element } = await render();
    http.match(() => true).forEach((request) => request.flush(new Blob([new Uint8Array([1])])));
    fixture.detectChanges();
    const entry = element.querySelector('.entry')!;

    expect(entry.querySelector('.entry__header .entry__check')).not.toBeNull();
    const unit = entry.querySelector('.unit')!;
    expect(unit.textContent).toContain('Руки с гель-лаком');
    expect(unit.querySelector('app-ref-gallery')).not.toBeNull();
    expect(unit.textContent).toContain(description);
    expect(unit.textContent).not.toContain('Лишний');
    expect(entry.textContent).toContain('Лишний');
    expect(entry.textContent).toContain('Снято 0 из 1');
  });

  it('says so under a frame that has no reference of its own', async () => {
    const first = [...plan.weeks()[0].items].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    TestBed.inject(Kits).stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit: { ...kit, frames: [kit.frames[0], { visual: 'Второй кадр', overlay: '' }] },
      },
    });
    TestBed.inject(Refs).statuses.set([
      status(first.id, {
        status: 'done',
        files: [
          {
            id: 'a',
            index: 0,
            kind: 'photo',
            mediaType: 'image/jpeg',
            caption: description,
            size: 1,
          },
        ],
      }),
    ]);
    const { element } = await render();

    const units = element.querySelector('.entry')!.querySelectorAll('.unit');
    expect(units[0].textContent).toContain(description);
    expect(units[1].textContent).toContain('отдельного референса нет');
  });

  it('ticks the whole activity and strikes it out', async () => {
    const first = [...plan.weeks()[0].items].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    TestBed.inject(Kits).stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit,
      },
    });
    const { fixture, element } = await render();
    const entry = element.querySelector('.entry')!;

    entry.querySelector<HTMLInputElement>('.entry__check')!.click();
    fixture.detectChanges();
    expect(entry.classList.contains('entry--done')).toBe(true);
    expect(entry.querySelectorAll('.unit--done').length).toBe(1);
    expect(entry.textContent).toContain('Снято 1 из 1');

    entry.querySelector<HTMLInputElement>('.entry__check')!.click();
    fixture.detectChanges();
    expect(entry.classList.contains('entry--done')).toBe(false);
    expect(entry.querySelectorAll('.unit--done').length).toBe(0);
  });

  it('shows the photo references with their detailed descriptions', async () => {
    const first = plan.weeks()[0].items[0];
    TestBed.inject(Refs).statuses.set([
      status(first.id, {
        status: 'done',
        files: [
          {
            id: 'a',
            index: 0,
            kind: 'photo',
            mediaType: 'image/jpeg',
            caption: description,
            size: 1,
          },
        ],
      }),
    ]);

    const { fixture, element } = await render();
    http
      .expectOne({ method: 'GET', url: `${API_DEV_URL}${API_REFS_FILES_PATH}/a` })
      .flush(new Blob([new Uint8Array([1])]));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelectorAll('img.tile__media').length).toBe(1);
    });

    expect(element.textContent).toContain('Описание кадра 1');
    expect(element.textContent).toContain(description);
  });

  it('says that the references are still being made', async () => {
    const first = plan.weeks()[0].items[0];
    TestBed.inject(Refs).statuses.set([status(first.id)]);

    const { element } = await render();

    expect(element.textContent).toContain('ещё готовятся');
  });

  it('puts the shooting block under every frame and passes the text on the frame', async () => {
    const first = [...plan.weeks()[0].items].sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
    )[0];
    TestBed.inject(Kits).stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit: { ...kit, frames: [kit.frames[0], { visual: 'Второй кадр', overlay: '' }] },
      },
    });
    const media = TestBed.inject(Media);
    media.setNote(first.id, 'Мой текст');
    const upload = vi.spyOn(media, 'upload').mockResolvedValue(undefined);

    const { element } = await render();

    const entry = element.querySelector('.entry')!;
    const units = entry.querySelectorAll('.unit');
    expect(units.length).toBe(2);
    expect(units[0].querySelector('app-media-capture')).not.toBeNull();
    expect(units[1].querySelector('app-media-capture')).not.toBeNull();
    const file = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
    const input = units[0].querySelector<HTMLInputElement>('input[capture]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(
      first,
      file,
      `${first.id}:frame:0`,
      'Смотрите',
      'Мой текст',
    );
    expect(element.textContent).toContain('кнопка «Снять»');
  });

  it('gives a publication without a kit one shooting block for the whole publication', async () => {
    const { element } = await render();

    const entry = element.querySelector('.entry')!;
    expect(entry.querySelectorAll('app-media-capture').length).toBe(1);
    expect(entry.querySelector('.unit')).toBeNull();
  });

  it('links to the finished content when there is some', async () => {
    const first = plan.weeks()[0].items[0];
    TestBed.inject(Media).statuses.set([
      {
        id: 'm1',
        key: first.id,
        unit: '',
        kind: 'photo',
        format: first.format,
        status: 'done',
        error: '',
        createdAt: '2026-10-26T10:00:00Z',
        source: { name: 'a.jpg', type: 'image/jpeg', size: 1 },
        redos: 0,
        canRedo: false,
      },
    ]);

    const { element } = await render();

    const link = element.querySelector<HTMLAnchorElement>('.entry__header a.entry__button')!;
    expect(link.textContent).toContain('Готовый контент (1)');
    expect(link.getAttribute('href')).toBe(`/content/${first.id}`);
  });
  it('says so when the week is not in the plan', async () => {
    const { element } = await render('9');

    expect(element.textContent).toContain('Такой недели в плане нет');
    expect(element.querySelector('.entry')).toBeNull();
  });
});
