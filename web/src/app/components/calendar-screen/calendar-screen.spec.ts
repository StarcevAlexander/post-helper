import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { samplePlan } from '../../testing/plan-fixture';
import { CalendarPlan } from '../../services/calendar-plan';
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
