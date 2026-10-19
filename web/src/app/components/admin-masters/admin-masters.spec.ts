import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_ADMIN_MASTERS_PATH, API_DEV_URL } from '../../constants';
import { MasterSummary } from '../../models';
import { Access } from '../../services/access';
import { AdminMasters } from './admin-masters';

const mastersUrl = `${API_DEV_URL}${API_ADMIN_MASTERS_PATH}`;

function button(element: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim().includes(label),
  );
  if (!found) {
    throw new Error(`no button ${label}`);
  }
  return found;
}

function master(overrides: Partial<MasterSummary> = {}): MasterSummary {
  return {
    id: 'm1',
    name: 'Анна',
    createdAt: '2026-10-19T08:00:00Z',
    lastSeenAt: '2026-10-19T09:30:00Z',
    disabled: false,
    usageToday: 3,
    usageTotal: 12,
    ...overrides,
  };
}

describe('AdminMasters', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('owner-secret-1');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function setUp(list: MasterSummary[] = [master()]) {
    const fixture = TestBed.createComponent(AdminMasters);
    http.expectOne({ method: 'GET', url: mastersUrl }).flush(list);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function typeName(element: HTMLElement, value: string): void {
    const input = element.querySelector<HTMLInputElement>('#master-name');
    if (!input) {
      throw new Error('no input');
    }
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('lists masters with their use of the AI', async () => {
    const { element } = await setUp([
      master(),
      master({ id: 'm2', name: 'Вера', usageToday: 0, usageTotal: 0 }),
    ]);

    const text = element.textContent ?? '';
    expect(element.querySelectorAll('.master').length).toBe(2);
    expect(text).toContain('Анна');
    expect(text).toContain('сегодня: 3');
    expect(text).toContain('всего: 12');
    expect(text).toContain('Вера');
  });

  it('says so when there are no masters yet', async () => {
    const { element } = await setUp([]);

    expect(element.textContent).toContain('Мастеров пока нет');
  });

  it('shows a mark for masters who never signed in', async () => {
    const { element } = await setUp([master({ lastSeenAt: '0001-01-01T00:00:00Z' })]);

    expect(element.textContent).toContain('ещё не входил');
  });

  it('creates a master and shows the code once', async () => {
    const { fixture, element } = await setUp([]);
    typeName(element, '  Мария  ');
    await fixture.whenStable();

    element.querySelector<HTMLButtonElement>('.create__button')?.click();
    const create = http.expectOne({ method: 'POST', url: mastersUrl });
    expect(create.request.body).toEqual({ name: 'Мария' });
    create.flush({ master: { id: 'm9', name: 'Мария' }, code: 'ABCDE-FGHJK-LMNPQ-RSTUV' });
    await vi.waitFor(() =>
      http
        .expectOne({ method: 'GET', url: mastersUrl })
        .flush([master({ id: 'm9', name: 'Мария' })]),
    );
    await fixture.whenStable();

    expect(element.querySelector('.code__value')?.textContent).toContain('ABCDE-FGHJK-LMNPQ-RSTUV');
    expect(element.textContent).toContain('Мария');
    expect((element.querySelector('#master-name') as HTMLInputElement).value).toBe('');

    element.querySelectorAll<HTMLButtonElement>('.code__button')[1].click();
    await fixture.whenStable();
    expect(element.querySelector('.code')).toBeNull();
  });

  it('does not create a master without a name', async () => {
    const { element } = await setUp([]);

    expect(element.querySelector<HTMLButtonElement>('.create__button')?.disabled).toBe(true);
  });

  it('copies the code', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { fixture, element } = await setUp([]);
    typeName(element, 'Мария');
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('.create__button')?.click();
    http
      .expectOne({ method: 'POST', url: mastersUrl })
      .flush({ master: { id: 'm9', name: 'Мария' }, code: 'ABCDE-FGHJK-LMNPQ-RSTUV' });
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: mastersUrl }))).flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    element.querySelectorAll<HTMLButtonElement>('.code__button')[0].click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('ABCDE-FGHJK-LMNPQ-RSTUV');
  });

  it('turns a master off and on', async () => {
    const { fixture, element } = await setUp();

    button(element, 'Отключить').click();
    const off = http.expectOne({ method: 'POST', url: `${mastersUrl}/m1/disabled` });
    expect(off.request.body).toEqual({ disabled: true });
    off.flush({ disabled: true });
    (await vi.waitFor(() => http.expectOne({ method: 'GET', url: mastersUrl }))).flush([
      master({ disabled: true }),
    ]);
    await fixture.whenStable();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.master--off')).toBeTruthy();
    expect(button(element, 'Включить')).toBeTruthy();
  });

  it('shows an error when the list cannot be loaded', async () => {
    const fixture = TestBed.createComponent(AdminMasters);
    http
      .expectOne({ method: 'GET', url: mastersUrl })
      .flush({ error: 'x' }, { status: 500, statusText: 'x' });
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.error')?.textContent).toContain(
      'Не удалось загрузить',
    );
  });

  describe('journal of a master', () => {
    const events = [
      {
        id: 2,
        kind: 'kit',
        payload: { request: { format: 'reels', idea: 'Видео снятия гель-лака' } },
        createdAt: '2026-10-19T09:00:00Z',
      },
      {
        id: 1,
        kind: 'chat',
        payload: { text: 'как привлечь клиентов' },
        createdAt: '2026-10-19T08:00:00Z',
      },
    ];
    const versions = [
      { version: 3, savedAt: '2026-10-19T09:00:00Z', size: 1200 },
      { version: 2, savedAt: '2026-10-19T08:30:00Z', size: 900 },
    ];

    async function openJournal() {
      const { fixture, element } = await setUp();
      button(element, 'Журнал').click();
      http.expectOne({ method: 'GET', url: `${mastersUrl}/m1/events?limit=100` }).flush(events);
      http.expectOne({ method: 'GET', url: `${mastersUrl}/m1/versions?limit=50` }).flush(versions);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(element.querySelectorAll('.journal__row--event').length).toBe(2);
      });
      return { fixture, element };
    }

    it('shows what the master asked and what the AI made, newest first', async () => {
      const { element } = await openJournal();

      const text = element.querySelector('.journal')?.textContent ?? '';
      expect(text).toContain('Комплект публикации');
      expect(text).toContain('reels: Видео снятия гель-лака');
      expect(text).toContain('Вопрос в чате');
      expect(text).toContain('как привлечь клиентов');
      expect(text.indexOf('Комплект публикации')).toBeLessThan(text.indexOf('Вопрос в чате'));
      expect(text).toContain('№ 3');
    });

    it('closes the journal on the second tap', async () => {
      const { fixture, element } = await openJournal();

      button(element, 'Свернуть журнал').click();
      fixture.detectChanges();

      expect(element.querySelector('.journal')).toBeNull();
    });

    it('asks twice before returning an older version and then reloads the journal', async () => {
      const { fixture, element } = await openJournal();
      const restore = () =>
        Array.from(element.querySelectorAll<HTMLButtonElement>('.journal__row .master__toggle'))[1];

      restore().click();
      fixture.detectChanges();
      expect(restore().textContent).toContain('Точно вернуть?');
      http.expectNone({ method: 'POST', url: `${mastersUrl}/m1/restore` });

      restore().click();
      const request = http.expectOne({ method: 'POST', url: `${mastersUrl}/m1/restore` });
      expect(request.request.body).toEqual({ version: 2 });
      request.flush({ version: 4, data: {}, updatedAt: '2026-10-19T10:00:00Z' });
      await vi.waitFor(() =>
        http.expectOne({ method: 'GET', url: `${mastersUrl}/m1/events?limit=100` }).flush(events),
      );
      http.expectOne({ method: 'GET', url: `${mastersUrl}/m1/versions?limit=50` }).flush(versions);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(element.querySelector('.notice')?.textContent).toContain('Версия возвращена');
    });

    it('deletes the master with all data only after a second tap', async () => {
      const { fixture, element } = await setUp();

      button(element, 'Удалить').click();
      fixture.detectChanges();
      expect(button(element, 'Точно удалить всё?')).toBeTruthy();
      http.expectNone({ method: 'DELETE', url: `${mastersUrl}/m1` });

      button(element, 'Точно удалить всё?').click();
      http.expectOne({ method: 'DELETE', url: `${mastersUrl}/m1` }).flush({ deleted: true });
      await vi.waitFor(() => http.expectOne({ method: 'GET', url: mastersUrl }).flush([]));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(element.querySelectorAll('.master').length).toBe(0);
      expect(element.querySelector('.notice')?.textContent).toContain('удалены');
    });

    it('downloads everything about a master as a file', async () => {
      const createUrl = vi.fn(() => 'blob:export');
      vi.stubGlobal(
        'URL',
        Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }),
      );
      const downloaded: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        downloaded.push(this.download);
      });
      const { element } = await setUp();

      button(element, 'Выгрузить').click();
      http.expectOne({ method: 'GET', url: `${mastersUrl}/m1/export` }).flush({
        exportedAt: '2026-10-19T10:00:00Z',
        master: { id: 'm1', name: 'Анна' },
        state: null,
        history: [],
        events: [],
      });
      await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));

      const blob = (createUrl.mock.calls[0] as unknown as [Blob])[0];
      expect(blob.type).toBe('application/json');
      expect(downloaded).toEqual(['master-export-m1.json']);
      expect(click).toHaveBeenCalledTimes(1);
    });
  });
});
