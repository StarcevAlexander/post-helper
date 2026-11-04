import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PublicationKit } from '../../models';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
import { IdeaRequests } from '../../services/idea-requests';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { Refs } from '../../services/refs';
import { ItemScreen } from './item-screen';

const kit: PublicationKit = {
  shots: ['Снять руки крупно'],
  frames: [{ visual: 'Руки с гель-лаком', overlay: 'Смотрите' }],
  caption: 'Показываю маникюр.',
  hashtags: ['#маникюр', '#иркутск'],
  tip: 'Спросите согласие клиента',
};

describe('ItemScreen', () => {
  let plan: CalendarPlan;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    plan = TestBed.inject(CalendarPlan);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function open(item = plan.items()[0]) {
    const fixture = TestBed.createComponent(ItemScreen);
    fixture.componentRef.setInput('id', item.id);
    await fixture.whenStable();
    return { item, fixture, element: fixture.nativeElement as HTMLElement };
  }

  function setUpWithPlan() {
    plan.load(samplePlan(new Date()));
  }

  it('says the publication is missing', async () => {
    setUpWithPlan();
    const fixture = TestBed.createComponent(ItemScreen);
    fixture.componentRef.setInput('id', 'no-such-item');
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Такой публикации в плане нет',
    );
  });

  it('shows the publication and marks it as done', async () => {
    setUpWithPlan();
    const { item, fixture, element } = await open();

    expect(element.textContent).toContain(item.idea);
    expect(element.textContent).toContain(item.pillar);

    element.querySelector<HTMLInputElement>('.entry__check')?.click();
    await fixture.whenStable();

    expect(plan.items().find((candidate) => candidate.id === item.id)?.done).toBe(true);
    expect(element.querySelector('.entry--done')).not.toBeNull();
  });

  it('says the kit is still to come when there is none', async () => {
    setUpWithPlan();
    const { element } = await open();

    expect(element.textContent).toContain('Комплект скоро появится');
    expect(element.querySelector('.caption')).toBeNull();
  });

  it('shows the kit text and copies the caption with hashtags', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    setUpWithPlan();
    const { item, fixture, element } = await open();
    TestBed.inject(Kits).stored.set({
      [item.id]: {
        itemId: item.id,
        format: item.format,
        pillar: item.pillar,
        idea: item.idea,
        kit,
      },
    });
    await fixture.whenStable();

    const kitLink = element.querySelector<HTMLAnchorElement>('a.entry__button');
    expect(kitLink?.getAttribute('href')).toBe(`/kit/${item.id}`);

    element.querySelector<HTMLButtonElement>('.caption__copy')?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('Показываю маникюр.\n\n#маникюр #иркутск');
    expect(element.querySelector('.entry__feedback')?.textContent).toContain('скопирован');
  });

  it('shows the reference and content states', async () => {
    setUpWithPlan();
    const { item, fixture, element } = await open();
    const [first, second, third] = plan.items();
    TestBed.inject(Refs).statuses.set([
      { key: first.id, status: 'done', kind: 'photo', stale: false, files: [
        { id: 'a', index: 0, kind: 'photo', mediaType: 'image/jpeg', caption: '', size: 1 },
        { id: 'b', index: 1, kind: 'photo', mediaType: 'image/jpeg', caption: '', size: 1 },
      ] },
      { key: second.id, status: 'done', kind: 'photo', stale: true, files: [] },
      { key: third.id, status: 'running', kind: 'photo', stale: false, files: [] },
    ]);
    const media = TestBed.inject(Media);
    media.statuses.set([
      {
        id: 'm1',
        key: item.id,
        unit: '',
        kind: 'photo',
        format: item.format,
        status: 'done',
        error: '',
        createdAt: '2026-10-26T10:00:00Z',
        source: { name: 'a.jpg', type: 'image/jpeg', size: 1 },
        redos: 0,
        canRedo: false,
      },
      {
        id: 'm2',
        key: item.id,
        unit: '',
        kind: 'photo',
        format: item.format,
        status: 'running',
        error: '',
        createdAt: '2026-10-26T10:00:00Z',
        source: { name: 'b.jpg', type: 'image/jpeg', size: 1 },
        redos: 0,
        canRedo: false,
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = element.textContent ?? '';
    expect(text).toContain('Референсы (2)');

    const [, staleItem, makingItem] = plan.items();
    fixture.componentRef.setInput('id', staleItem.id);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Подтвердите, что контент изготовлен',
    );

    fixture.componentRef.setInput('id', makingItem.id);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Референсы делаются');

    fixture.componentRef.setInput('id', item.id);
    await fixture.whenStable();
    fixture.detectChanges();

    const contentLink = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).find((link) =>
      link.textContent?.includes('Готовый контент (1)'),
    );
    expect(contentLink?.getAttribute('href')).toBe(`/content/${item.id}`);
    expect(text).toContain('Контент обрабатывается');
  });

  it('warns about stale references', async () => {
    setUpWithPlan();
    const { item, fixture, element } = await open();
    TestBed.inject(Refs).statuses.set([
      { key: item.id, status: 'done', kind: 'photo', stale: true, files: [] },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.entry__button--warn')?.textContent).toContain(
      'Подтвердите, что контент изготовлен',
    );
    expect(element.querySelector('.entry__button--warn')).not.toBeNull();
  });

  it('moves the publication and returns it back', async () => {
    setUpWithPlan();
    const { item, fixture, element } = await open();

    element.querySelector<HTMLButtonElement>('.entry__move')?.click();
    await fixture.whenStable();

    const moved = plan.items().find((candidate) => candidate.id === item.id)!;
    expect(moved.movedFrom).toBe(item.date);

    const back = element.querySelector<HTMLButtonElement>('.entry__return');
    expect(back?.textContent).toContain('Вернуть на');
    back?.click();
    await fixture.whenStable();

    expect(plan.items().find((candidate) => candidate.id === item.id)?.date).toBe(item.date);
    expect(element.querySelector('.entry__return')).toBeNull();
  });

  it('links to the idea replacement and shows when it is already requested', async () => {
    setUpWithPlan();
    const { item, fixture, element } = await open();

    expect(element.querySelector('.entry__replace')?.getAttribute('href')).toBe(
      `/replace/${item.id}`,
    );

    TestBed.inject(IdeaRequests).marks.set({
      [item.id]: { idea: item.idea, sentAt: 'x' },
    });
    await fixture.whenStable();

    expect(element.querySelector('.entry__replace')).toBeNull();
    expect(element.textContent).toContain('Замена запрошена');
  });
});
