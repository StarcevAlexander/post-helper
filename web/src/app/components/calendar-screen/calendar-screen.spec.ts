import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
import { Kits } from '../../services/kits';
import { Media } from '../../services/media';
import { Refs } from '../../services/refs';
import { CalendarScreen } from './calendar-screen';

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

  it('links a publication to its finished content', async () => {
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
        status: 'done',
        error: '',
        createdAt: '2026-10-26T10:00:00Z',
        source: { name: 'a.jpg', type: 'image/jpeg', size: 1 },
        redos: 0,
        canRedo: false,
      },
    ]);
    fixture.detectChanges();

    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('.item a')).filter(
      (link) => link.textContent?.includes('Готовый контент (1)'),
    );
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe(`/content/${first.id}`);
  });
  it('shows the state of the references next to each publication and warns about overdue ones', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const [first, second, third] = TestBed.inject(CalendarPlan).items();
    TestBed.inject(Refs).statuses.set([
      { key: first.id, status: 'done', kind: 'photo', stale: true, files: [] },
      {
        key: second.id,
        status: 'done',
        kind: 'photo',
        stale: false,
        files: [
          { id: 'a', index: 0, kind: 'photo', mediaType: 'image/jpeg', caption: '', size: 1 },
          { id: 'b', index: 1, kind: 'photo', mediaType: 'image/jpeg', caption: '', size: 1 },
        ],
      },
      { key: third.id, status: 'running', kind: 'photo', stale: false, files: [] },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const text = element.textContent ?? '';
    expect(text).toContain('Подтвердите, что контент изготовлен');
    expect(text).toContain('Референсы (2)');
    expect(text).toContain('Референсы делаются');
    expect(element.querySelector('.screen__hint--warn')?.textContent).toContain(
      'Новые референсы пока не делаются',
    );
    expect(element.querySelectorAll('.item__button--warn').length).toBe(1);
  });

  it('opens a delivered kit and says the others are still to come', async () => {
    const { fixture, element } = setUp();
    await fixture.whenStable();
    const plan = TestBed.inject(CalendarPlan);
    const kits = TestBed.inject(Kits);
    const [first] = plan.items();
    kits.stored.set({
      [first.id]: {
        itemId: first.id,
        format: first.format,
        pillar: first.pillar,
        idea: first.idea,
        kit: {
          shots: [],
          frames: [{ visual: 'a', overlay: 'b' }],
          caption: 'c',
          hashtags: [],
          tip: '',
        },
      },
    });
    await fixture.whenStable();

    const buttons = element.querySelectorAll<HTMLAnchorElement>('.item__kit a[href^="/kit/"]');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Открыть комплект');
    expect(element.querySelectorAll('.item__kit .item__status').length).toBe(11);
    expect(element.querySelectorAll('.item__kit .item__move').length).toBe(12);
    expect(element.querySelectorAll('.item__kit a[href^="/replace/"]').length).toBe(12);

    expect(buttons[0].getAttribute('href')).toBe(`/kit/${first.id}`);
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
