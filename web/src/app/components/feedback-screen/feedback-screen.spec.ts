import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_DEV_URL, API_FEEDBACK_PATH, FEEDBACK_TEXTS } from '../../constants';
import { Access } from '../../services/access';
import { FeedbackScreen } from './feedback-screen';

describe('FeedbackScreen', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  async function render() {
    const fixture = TestBed.createComponent(FeedbackScreen);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    element.value = value;
    element.dispatchEvent(new Event('input'));
  }

  it('asks for the message and an optional contact, the button waits for text', async () => {
    const { element } = await render();

    expect(element.querySelector('#feedback-text')).not.toBeNull();
    expect(element.querySelector('#feedback-contact')).not.toBeNull();
    expect(element.textContent).toContain(FEEDBACK_TEXTS.contactHint);
    expect(element.querySelector<HTMLButtonElement>('.screen__primary')?.disabled).toBe(true);
  });

  it('sends the message and thanks the user', async () => {
    const { fixture, element } = await render();

    type(element.querySelector<HTMLTextAreaElement>('#feedback-text')!, 'Не работает пуш');
    type(element.querySelector<HTMLInputElement>('#feedback-contact')!, '@anna');
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.screen__primary')!.click();

    const request = http.expectOne({ method: 'POST', url: `${API_DEV_URL}${API_FEEDBACK_PATH}` });
    expect(request.request.body).toEqual({ text: 'Не работает пуш', contact: '@anna' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element.textContent).toContain(FEEDBACK_TEXTS.sentTitle);
    expect(element.querySelector('#feedback-text')).toBeNull();
  });
});
