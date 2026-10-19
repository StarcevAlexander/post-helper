import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_CHAT_PATH,
  API_DEV_URL,
  API_MESSAGES,
  CHAT_HISTORY_STORAGE_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
} from '../constants';
import { Access } from './access';
import { Chat } from './chat';

describe('Chat', () => {
  let chat: Chat;
  let access: Access;
  let http: HttpTestingController;

  const chatUrl = `${API_DEV_URL}${API_CHAT_PATH}`;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        index: ONBOARDING_STEPS.length,
        answers: { specialty: 'маникюр' },
        confirmed: true,
      }),
    );
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    chat = TestBed.inject(Chat);
    access = TestBed.inject(Access);
    http = TestBed.inject(HttpTestingController);
    access.save('secret-pass');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('starts with a welcome message from the assistant', () => {
    expect(chat.messages().length).toBe(1);
    expect(chat.messages()[0].role).toBe('assistant');
  });

  it('sends the message with the password and resolves the pending reply', async () => {
    chat.send({ text: 'Привет', attachments: [] });

    expect(chat.messages().length).toBe(3);
    expect(chat.messages()[1].text).toBe('Привет');
    expect(chat.messages()[2].pending).toBe(true);
    expect(chat.busy()).toBe(true);

    const request = http.expectOne(chatUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer secret-pass');
    const body = request.request.body as FormData;
    expect(body.get('text')).toBe('Привет');
    request.flush({ reply: 'Здравствуйте' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    expect(chat.messages()[2].pending).toBe(false);
    expect(chat.messages()[2].failed).toBe(false);
    expect(chat.messages()[2].text).toBe('Здравствуйте');
    expect(chat.busy()).toBe(false);
  });

  it('sends earlier finished turns as history', async () => {
    chat.send({ text: 'Первый', attachments: [] });
    http.expectOne(chatUrl).flush({ reply: 'Ответ' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    chat.send({ text: 'Второй', attachments: [] });
    const body = http.expectOne(chatUrl).request.body as FormData;
    const history = JSON.parse(body.get('history') as string) as { role: string; text: string }[];

    expect(history.map((turn) => turn.text)).toContain('Первый');
    expect(history.map((turn) => turn.text)).toContain('Ответ');
    expect(history.map((turn) => turn.text)).not.toContain('Второй');
  });

  it('keeps one conversation id between messages and starts a new one after clearing', async () => {
    chat.send({ text: 'Первый', attachments: [] });
    const first = http.expectOne(chatUrl);
    const firstId = (first.request.body as FormData).get('conversation') as string;
    first.flush({ reply: 'Ответ' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    chat.send({ text: 'Второй', attachments: [] });
    const second = http.expectOne(chatUrl);
    expect((second.request.body as FormData).get('conversation')).toBe(firstId);
    second.flush({ reply: 'Ещё ответ' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    chat.clear();
    chat.send({ text: 'Новый', attachments: [] });
    const third = http.expectOne(chatUrl);
    const thirdId = (third.request.body as FormData).get('conversation') as string;
    third.flush({ reply: 'Привет снова' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    expect(firstId).not.toBe('');
    expect(thirdId).not.toBe(firstId);
  });

  it('marks the reply as failed and clears the password on 401', async () => {
    chat.send({ text: 'Привет', attachments: [] });
    http
      .expectOne(chatUrl)
      .flush({ error: 'Неверный пароль' }, { status: 401, statusText: 'Unauthorized' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    expect(chat.messages()[2].failed).toBe(true);
    expect(chat.messages()[2].text).toBe(API_MESSAGES.unauthorized);
    expect(access.granted()).toBe(false);
  });

  it('shows the server error text on other failures', async () => {
    chat.send({ text: 'Привет', attachments: [] });
    http
      .expectOne(chatUrl)
      .flush({ error: 'Файлы слишком большие' }, { status: 413, statusText: 'Too Large' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    expect(chat.messages()[2].failed).toBe(true);
    expect(chat.messages()[2].text).toBe('Файлы слишком большие');
    expect(access.granted()).toBe(true);
  });

  describe('retry', () => {
    const unavailable = { error: 'Помощник временно недоступен, попробуйте ещё раз' };

    async function failFirstAsk(text = 'Привет'): Promise<string> {
      chat.send({ text, attachments: [] });
      http.expectOne(chatUrl).flush(unavailable, { status: 502, statusText: 'Bad Gateway' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));
      return chat.messages()[1].id;
    }

    it('offers a retry only for the user message whose reply failed', async () => {
      const id = await failFirstAsk();

      expect(chat.retryableIds().has(id)).toBe(true);
      expect(chat.retryableIds().size).toBe(1);
    });

    it('resends the same message into the failed reply without adding messages', async () => {
      const id = await failFirstAsk();

      chat.retry(id);
      expect(chat.busy()).toBe(true);
      expect(chat.messages().length).toBe(3);
      expect(chat.messages()[2].pending).toBe(true);
      expect(chat.messages()[2].failed).toBe(false);
      expect(chat.retryableIds().size).toBe(0);

      const request = http.expectOne(chatUrl);
      expect((request.request.body as FormData).get('text')).toBe('Привет');
      request.flush({ reply: 'Ок' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));
    });

    it('sends the earlier turns but not the retried exchange as history', async () => {
      chat.send({ text: 'Первый', attachments: [] });
      http.expectOne(chatUrl).flush({ reply: 'Ответ' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));
      chat.send({ text: 'Второй', attachments: [] });
      http.expectOne(chatUrl).flush(unavailable, { status: 502, statusText: 'x' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      chat.retry(chat.messages()[3].id);
      const body = http.expectOne(chatUrl).request.body as FormData;
      const history = JSON.parse(body.get('history') as string) as { text: string }[];

      expect(history.map((turn) => turn.text)).toContain('Ответ');
      expect(history.map((turn) => turn.text)).not.toContain('Второй');
    });

    it('shows the answer in the same bubble when the retry succeeds', async () => {
      const id = await failFirstAsk();
      const replyId = chat.messages()[2].id;

      chat.retry(id);
      http.expectOne(chatUrl).flush({ reply: 'Здравствуйте' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      expect(chat.messages().length).toBe(3);
      expect(chat.messages()[2].id).toBe(replyId);
      expect(chat.messages()[2].text).toBe('Здравствуйте');
      expect(chat.messages()[2].failed).toBe(false);
      expect(chat.retryableIds().size).toBe(0);
    });

    it('keeps the retry available when it fails again', async () => {
      const id = await failFirstAsk();

      chat.retry(id);
      http.expectOne(chatUrl).flush(unavailable, { status: 502, statusText: 'x' });
      await vi.waitFor(() => expect(chat.busy()).toBe(false));

      expect(chat.messages()[2].failed).toBe(true);
      expect(chat.retryableIds().has(id)).toBe(true);
    });

    it('does nothing while another request is pending', async () => {
      const id = await failFirstAsk();
      chat.send({ text: 'Ещё', attachments: [] });

      chat.retry(id);

      expect(chat.messages().length).toBe(5);
      http.expectOne(chatUrl).flush({ reply: 'Ок' });
    });
  });

  it('removes a finished message but keeps a pending one', async () => {
    chat.send({ text: 'Привет', attachments: [] });
    const [, userMessage, pendingMessage] = chat.messages();

    chat.remove(pendingMessage.id);
    expect(chat.messages().length).toBe(3);

    http.expectOne(chatUrl).flush({ reply: 'Ок' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    chat.remove(userMessage.id);
    expect(chat.messages().map((message) => message.id)).not.toContain(userMessage.id);
    expect(chat.messages().length).toBe(2);
  });

  it('saves the conversation and restores it in a new session', async () => {
    chat.send({ text: 'Привет', attachments: [] });
    http.expectOne(chatUrl).flush({ reply: 'Здравствуйте' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));
    TestBed.tick();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const restored = TestBed.inject(Chat);

    expect(restored.messages().map((message) => message.text)).toContain('Привет');
    expect(restored.messages().map((message) => message.text)).toContain('Здравствуйте');
  });

  it('does not persist failed replies', async () => {
    chat.send({ text: 'Привет', attachments: [] });
    http.expectOne(chatUrl).flush({ error: 'Сбой' }, { status: 500, statusText: 'Error' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));
    TestBed.tick();

    const stored = JSON.parse(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) ?? '[]') as {
      text: string;
    }[];
    expect(stored.map((message) => message.text)).toContain('Привет');
    expect(stored.map((message) => message.text)).not.toContain('Сбой');
  });

  it('clears the conversation back to the welcome message', async () => {
    chat.send({ text: 'Привет', attachments: [] });
    http.expectOne(chatUrl).flush({ reply: 'Ок' });
    await vi.waitFor(() => expect(chat.busy()).toBe(false));

    chat.clear();
    TestBed.tick();

    expect(chat.messages().length).toBe(1);
    expect(chat.messages()[0].role).toBe('assistant');
    const stored = JSON.parse(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) ?? '[]') as unknown[];
    expect(stored.length).toBe(1);
  });

  it('does not clear while a reply is pending', () => {
    chat.send({ text: 'Привет', attachments: [] });

    chat.clear();

    expect(chat.messages().length).toBe(3);
    http.expectOne(chatUrl).flush({ reply: 'Ок' });
  });

  it('ignores empty messages without attachments', () => {
    chat.send({ text: '   ', attachments: [] });

    expect(chat.messages().length).toBe(1);
    expect(chat.busy()).toBe(false);
  });
});
