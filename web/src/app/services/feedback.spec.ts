import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_FEEDBACK_PATH,
  FEEDBACK_CONTACT_STORAGE_KEY,
  MAX_FEEDBACK_TEXT,
} from '../constants';
import { Access } from './access';
import { Feedback } from './feedback';

const feedbackUrl = `${API_DEV_URL}${API_FEEDBACK_PATH}`;

describe('Feedback', () => {
  let feedback: Feedback;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    feedback = TestBed.inject(Feedback);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('cannot be sent empty', async () => {
    feedback.setText('   ');

    expect(feedback.canSubmit()).toBe(false);
    await feedback.submit();

    expect(feedback.error()).toContain('Напишите сообщение');
  });

  it('cuts the text and the contact to the limits', () => {
    feedback.setText('я'.repeat(MAX_FEEDBACK_TEXT + 50));
    feedback.setContact('x'.repeat(500));

    expect(feedback.text().length).toBe(MAX_FEEDBACK_TEXT);
    expect(feedback.contact().length).toBe(200);
  });

  it('sends the trimmed message with the contact and remembers the contact', async () => {
    feedback.setText('  Не приходит напоминание ');
    feedback.setContact(' @anna ');

    const pending = feedback.submit();
    const request = http.expectOne({ method: 'POST', url: feedbackUrl });
    expect(request.request.body).toEqual({ text: 'Не приходит напоминание', contact: '@anna' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await pending;

    expect(feedback.sent()).toBe(true);
    expect(feedback.text()).toBe('');
    expect(localStorage.getItem(FEEDBACK_CONTACT_STORAGE_KEY)).toBe('@anna');
  });

  it('shows the server message and keeps the text when sending fails', async () => {
    feedback.setText('Привет');

    const pending = feedback.submit();
    http
      .expectOne(feedbackUrl)
      .flush({ error: 'Вы уже отправили несколько сообщений' }, { status: 429, statusText: 'x' });
    await pending;

    expect(feedback.sent()).toBe(false);
    expect(feedback.text()).toBe('Привет');
    expect(feedback.error()).toContain('несколько сообщений');
    expect(feedback.busy()).toBe(false);
  });

  it('refills the contact from the previous message', () => {
    localStorage.setItem(FEEDBACK_CONTACT_STORAGE_KEY, '+7 900 000');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    expect(TestBed.inject(Feedback).contact()).toBe('+7 900 000');
  });
});
