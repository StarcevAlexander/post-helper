import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
import { Media } from '../../services/media';
import { Refs } from '../../services/refs';
import { CalendarScreen } from './calendar-screen';

function fakeTouch(target: EventTarget, x: number, y: number): Touch {
  return { identifier: 1, target, clientX: x, clientY: y } as unknown as Touch;
}

function swipe(card: Element, fromX: number, toX: number): void {
  card.dispatchEvent(
    new TouchEvent('touchstart', { touches: [fakeTouch(card, fromX, 40)] }),
  );
  card.dispatchEvent(
    new TouchEvent('touchend', { changedTouches: [fakeTouch(card, toX, 40)] }),
  );
}

describe('CalendarScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function setUp(withPlan = true) {
    if (withPlan) {
      TestBed.inject(CalendarPlan).load(samplePlan(new Date()));
    }
    const fixture = TestBed.createComponent(CalendarScreen);
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('tells that the plan has not arrived yet', async () => {
    const { fixture, element } = setUp(false);
    await fixture.whenStable();

    expect(element.textContent).toContain('Плана пока нет');
    expect(element.querySelector('.slots')).toBeNull();
  });

  it('shows the weeks of the delivered plan with their content day', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    expect(element.querySelectorAll('.week').length).toBe(4);
    expect(element.querySelector('.week__content-day')?.textContent).toContain('18:00');
    expect(element.querySelectorAll('.item').length).toBe(12);
  });

  it('marks a publication as done', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    element.querySelector<HTMLInputElement>('.item__check')?.click();
    await fixture.whenStable();

    expect(TestBed.inject(CalendarPlan).items()[0].done).toBe(true);
    expect(element.querySelector('.item--done')).toBeTruthy();
  });

  it('links every publication to its details screen and carries no buttons', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const plan = TestBed.inject(CalendarPlan);

    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('.item a'));
    expect(links.length).toBe(plan.items().length);
    expect(links[0].getAttribute('href')).toBe(`/item/${plan.items()[0].id}`);
    expect(element.textContent).not.toContain('Открыть комплект');
    expect(element.querySelector('.item__move')).toBeNull();
  });

  it('tells while the content is being processed', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const [first] = TestBed.inject(CalendarPlan).items();

    TestBed.inject(Media).statuses.set([
      {
        id: 'm1',
        key: first.id,
        unit: '',
        kind: 'photo',
        format: first.format,
        status: 'running',
        error: '',
        createdAt: '2026-10-26T10:00:00Z',
        source: { name: 'a.jpg', type: 'image/jpeg', size: 1 },
        redos: 0,
        canRedo: false,
      },
    ]);
    fixture.detectChanges();

    expect(element.textContent).toContain('Контент обрабатывается');
  });

  it('marks a publication as done by a swipe to the right', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const [first] = TestBed.inject(CalendarPlan).items();
    const card = element.querySelector<HTMLLIElement>('.item')!;

    swipe(card, 40, 160);
    await fixture.whenStable();

    expect(TestBed.inject(CalendarPlan).items()[0].done).toBe(true);
    expect(element.querySelector('.item--done')).toBeTruthy();
  });

  it('moves a publication away by a swipe to the left', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const [first] = TestBed.inject(CalendarPlan).items();
    const card = element.querySelector<HTMLLIElement>('.item')!;

    swipe(card, 160, 40);
    await fixture.whenStable();

    const moved = TestBed.inject(CalendarPlan).items()[0];
    expect(moved.movedFrom).toBe(first.date);
    expect(moved.date).not.toBe(first.date);
    expect(element.querySelector('.moved')?.textContent).toContain('перенесено на');
  });

  it('warns when references are blocked', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const [first] = TestBed.inject(CalendarPlan).items();
    TestBed.inject(Refs).statuses.set([
      { key: first.id, status: 'done', kind: 'photo', stale: true, files: [] },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.querySelector('.screen__hint--warn')?.textContent).toContain(
      'Новые референсы пока не делаются',
    );
  });

  it('links every week to its shooting list', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();

    const links = Array.from(
      element.querySelectorAll<HTMLAnchorElement>('.week a[href^="/shoot/"]'),
    );

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/shoot/0',
      '/shoot/1',
      '/shoot/2',
      '/shoot/3',
    ]);
  });
});
