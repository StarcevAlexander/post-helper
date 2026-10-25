import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_FEEDBACK_PATH,
  IDEA_REQUESTS_STORAGE_KEY,
  MAX_IDEA_REQUEST_TEXT,
} from '../constants';
import { PlanItem } from '../models';
import { Access } from './access';
import { IdeaRequests } from './idea-requests';

const feedbackUrl = `${API_DEV_URL}${API_FEEDBACK_PATH}`;

const item: PlanItem = {
  id: 'w1-mon',
  date: '2026-10-26',
  time: '19:00',
  format: 'reels',
  pillar: 'Процесс',
  idea: 'Тонирование',
  done: false,
};

describe('IdeaRequests', () => {
  let ideas: IdeaRequests;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
    ideas = TestBed.inject(IdeaRequests);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('cannot be sent empty and cuts the text to the limit', async () => {
    ideas.setText('   ');
    expect(ideas.canSubmit()).toBe(false);
    expect(await ideas.submit(item)).toBe(false);
    expect(ideas.error()).toContain('Напишите');

    ideas.setText('я'.repeat(MAX_IDEA_REQUEST_TEXT + 10));
    expect(ideas.text().length).toBe(MAX_IDEA_REQUEST_TEXT);
  });

  it('sends the wish with the publication id and marks the idea as requested', async () => {
    ideas.setText('  Лучше про уход за блондом ');

    const pending = ideas.submit(item);
    const request = http.expectOne({ method: 'POST', url: feedbackUrl });
    expect(request.request.body).toEqual({
      text: 'Лучше про уход за блондом',
      contact: '',
      itemId: 'w1-mon',
    });
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(await pending).toBe(true);
    expect(ideas.sent()).toBe(true);
    expect(ideas.text()).toBe('');
    expect(ideas.requested(item)).toBe(true);
    expect(ideas.requested({ ...item, idea: 'Уход за блондом' })).toBe(false);
    expect(JSON.parse(localStorage.getItem(IDEA_REQUESTS_STORAGE_KEY) ?? '{}')).toHaveProperty(
      'w1-mon.idea',
      'Тонирование',
    );
  });

  it('keeps the text and shows the server message when sending fails', async () => {
    ideas.setText('Другое');

    const pending = ideas.submit(item);
    http
      .expectOne(feedbackUrl)
      .flush({ error: 'Такой публикации нет' }, { status: 404, statusText: 'Not Found' });

    expect(await pending).toBe(false);
    expect(ideas.text()).toBe('Другое');
    expect(ideas.error()).toBe('Такой публикации нет');
    expect(ideas.requested(item)).toBe(false);
  });

  it('restores the marks and ignores broken ones', () => {
    localStorage.setItem(
      IDEA_REQUESTS_STORAGE_KEY,
      JSON.stringify({ 'w1-mon': { idea: 'Тонирование', sentAt: 'x' }, bad: 'nope' }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    const restored = TestBed.inject(IdeaRequests);

    expect(restored.requested(item)).toBe(true);
    expect(Object.keys(restored.marks())).toEqual(['w1-mon']);
  });
});
