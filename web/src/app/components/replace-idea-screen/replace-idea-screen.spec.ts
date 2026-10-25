import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_FEEDBACK_PATH, IDEA_REQUEST_TEXTS } from '../../constants';
import { samplePlan } from '../../testing/plan-fixture';
import { Access } from '../../services/access';
import { CalendarPlan } from '../../services/calendar-plan';
import { ReplaceIdeaScreen } from './replace-idea-screen';

const feedbackUrl = `${API_DEV_URL}${API_FEEDBACK_PATH}`;

describe('ReplaceIdeaScreen', () => {
  let plan: CalendarPlan;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    plan = TestBed.inject(CalendarPlan);
    plan.load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  async function render(id: string) {
    const fixture = TestBed.createComponent(ReplaceIdeaScreen);
    fixture.componentRef.setInput('id', id);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the publication and sends the wish for it', async () => {
    const item = plan.items()[0];
    const { fixture, element } = await render(item.id);

    expect(element.textContent).toContain(item.idea);
    expect(element.textContent).toContain(IDEA_REQUEST_TEXTS.intro);
    const submit = element.querySelector<HTMLButtonElement>('.screen__primary')!;
    expect(submit.disabled).toBe(true);

    const textarea = element.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'Лучше про результат';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
    submit.click();

    const request = http.expectOne({ method: 'POST', url: feedbackUrl });
    expect(request.request.body).toMatchObject({ text: 'Лучше про результат', itemId: item.id });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.textContent).toContain(IDEA_REQUEST_TEXTS.sentTitle);
    expect(element.querySelector('a.screen__secondary')?.getAttribute('href')).toBe('/calendar');
  });

  it('tells the master when the replacement is already requested', async () => {
    const item = plan.items()[1];
    localStorage.setItem(
      'helper.idea-requests',
      JSON.stringify({ [item.id]: { idea: item.idea, sentAt: '2026-10-20T10:00:00Z' } }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(CalendarPlan).load(samplePlan(new Date(2026, 9, 19, 10, 0)));
    http = TestBed.inject(HttpTestingController);

    const { element } = await render(item.id);

    expect(element.textContent).toContain(IDEA_REQUEST_TEXTS.pendingText);
    expect(element.querySelector('textarea')).toBeNull();
  });

  it('explains when the publication is gone', async () => {
    const { element } = await render('no-such-item');

    expect(element.textContent).toContain(IDEA_REQUEST_TEXTS.missing);
  });
});
