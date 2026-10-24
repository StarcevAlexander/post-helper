import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_REFS_FILES_PATH } from '../../constants';
import { PublicationKit, RefStatus, ScheduleDraft, Strategy } from '../../models';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Refs } from '../../services/refs';
import { ShootScreen } from './shoot-screen';

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
    plan.build(draft, strategy, new Date(2026, 9, 19, 10, 0));
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

  it('says so when the week is not in the plan', async () => {
    const { element } = await render('9');

    expect(element.textContent).toContain('Такой недели в плане нет');
    expect(element.querySelector('.entry')).toBeNull();
  });
});
