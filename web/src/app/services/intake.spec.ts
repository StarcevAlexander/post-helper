import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  API_DEV_URL,
  API_INTAKE_PATH,
  API_ME_PATH,
  INTAKE_MAX_LINKS,
  INTAKE_MAX_REFERENCES,
  INTAKE_MIN_REFERENCES,
  INTAKE_POLL_MS,
  INTAKE_SEEN_STORAGE_KEY,
} from '../constants';
import { IntakeRequest } from '../models';
import { Access } from './access';
import { Intake } from './intake';
import { Sync } from './sync';

const intakeUrl = `${API_DEV_URL}${API_INTAKE_PATH}`;

function request(overrides: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    id: 'r1',
    networks: [{ platform: 'vk', url: 'https://vk.com/anna' }],
    references: [{ platform: 'vk', url: 'https://vk.com/ref_one' }],
    goals: ['reach', 'check'],
    note: 'Без танцев',
    status: 'new',
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:00Z',
    ...overrides,
  };
}

describe('Intake', () => {
  let intake: Intake;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    intake = TestBed.inject(Intake);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
  });

  afterEach(() => {
    intake.stop();
    http.match(() => true);
    localStorage.clear();
    vi.useRealTimers();
  });

  function fillDraft(): void {
    intake.setLink(0, ' vk.com/anna ');
    intake.toggleGoal('reach');
    intake.setNote('  Не показывать лицо  ');
  }

  async function loadEmpty(): Promise<void> {
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(null, { status: 204, statusText: 'No Content' });
    await pending;
  }

  it('hides the form until the state of the request is known and offers a retry', async () => {
    expect(intake.showForm()).toBe(false);
    expect(intake.connecting()).toBe(true);

    const pending = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).error(new ProgressEvent('error'));
    await pending;

    expect(intake.loaded()).toBe(false);
    expect(intake.showForm()).toBe(false);
    expect(intake.error()).toBeDefined();

    const retried = intake.retry();
    const attempts = http.match({ method: 'GET', url: `${API_DEV_URL}${API_ME_PATH}` });
    expect(attempts.length).toBeGreaterThan(0);
    attempts.forEach((attempt) => attempt.error(new ProgressEvent('error')));
    await retried;
    expect(intake.connecting()).toBe(true);
  });

  it('does not allow sending without a link or a goal', () => {
    expect(intake.canSubmit()).toBe(false);
    intake.setLink(0, 'vk.com/anna');
    expect(intake.canSubmit()).toBe(false);
    intake.toggleGoal('reach');
    expect(intake.canSubmit()).toBe(true);
    intake.toggleGoal('reach');
    expect(intake.canSubmit()).toBe(false);
  });

  it('sends cleaned links, goals and the wishes', async () => {
    await loadEmpty();
    fillDraft();

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).toMatchObject({
      links: ['vk.com/anna'],
      references: [],
      goals: ['reach'],
      note: 'Не показывать лицо',
      city: '',
    });
    sent.flush(request());

    expect(await pending).toBe(true);
    expect(intake.pending()).toBe(true);
    expect(intake.showForm()).toBe(false);
  });

  it('keeps the form and shows the server message when sending fails', async () => {
    await loadEmpty();
    fillDraft();

    const pending = intake.submit();
    http
      .expectOne({ method: 'POST', url: intakeUrl })
      .flush({ error: 'Не удалось понять ссылку' }, { status: 400, statusText: 'Bad Request' });

    expect(await pending).toBe(false);
    expect(intake.error()).toBe('Не удалось понять ссылку');
    expect(intake.showForm()).toBe(true);
  });

  it('opens the form for a new master without a plan', async () => {
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(null, { status: 204, statusText: 'No Content' });
    await pending;

    expect(intake.loaded()).toBe(true);
    expect(intake.showForm()).toBe(true);
  });

  it('refills the form from a pending request and polls until it is ready', async () => {
    vi.useFakeTimers();
    const pending = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(request());
    await pending;

    intake.edit();
    expect(intake.draft()).toEqual({
      links: ['https://vk.com/anna'],
      references: ['https://vk.com/ref_one', '', '', '', ''],
      goals: ['reach', 'check'],
      note: 'Без танцев',
      city: '',
      stats: { followers: '', reach: '', bestPost: '' },
      schedule: { shootDays: [], shootTime: '', publishTime: '' },
    });

    intake.cancelEdit();
    vi.advanceTimersByTime(INTAKE_POLL_MS);
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(request());
  });

  it('shows the ready plan once and pulls the delivered data', async () => {
    const ready = request({
      status: 'ready',
      readyAt: '2026-10-23T10:00:00Z',
      replyNote: 'План готов',
    });
    const pull = vi.spyOn(TestBed.inject(Sync), 'pull').mockResolvedValue();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const pending = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(ready);
    await pending;

    expect(navigate).not.toHaveBeenCalled();
    expect(intake.ready()).toBe(true);
    expect(intake.readyUnseen()).toBe(true);
    expect(pull).toHaveBeenCalledTimes(1);

    intake.markSeen();
    expect(localStorage.getItem(INTAKE_SEEN_STORAGE_KEY)).toBe('2026-10-23T10:00:00Z');
    expect(intake.readyUnseen()).toBe(false);
    const again = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(ready);
    await again;
    expect(navigate).not.toHaveBeenCalled();
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('starts a new request from the previous links and goals without the old wishes', async () => {
    vi.spyOn(TestBed.inject(Sync), 'pull').mockResolvedValue();
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(request({ status: 'ready', readyAt: '2026-10-23T10:00:00Z' }));
    await pending;

    intake.startNew();

    expect(intake.showForm()).toBe(true);
    expect(intake.draft()).toEqual({
      links: ['https://vk.com/anna'],
      references: ['https://vk.com/ref_one', '', '', '', ''],
      goals: ['reach', 'check'],
      note: '',
      city: '',
      stats: { followers: '', reach: '', bestPost: '' },
      schedule: { shootDays: [], shootTime: '', publishTime: '' },
    });
  });

  it('offers five reference slots, sends the filled ones and allows more without a limit in the form', async () => {
    expect(intake.draft().references).toHaveLength(INTAKE_MIN_REFERENCES);

    intake.setReference(0, ' instagram.com/ref_one ');
    intake.setReference(3, 'vk.com/ref_two');
    for (let index = 0; index < 10; index += 1) {
      intake.addReference();
    }
    expect(intake.draft().references).toHaveLength(INTAKE_MIN_REFERENCES + 10);
    intake.setReference(14, 'ref-blog.ru');
    fillDraft();

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).toMatchObject({
      references: ['instagram.com/ref_one', 'vk.com/ref_two', 'ref-blog.ru'],
    });
    sent.flush(request());
    expect(await pending).toBe(true);
  });

  it('caps the references and keeps the five slots after removal', () => {
    for (let index = 0; index < INTAKE_MAX_REFERENCES + 5; index += 1) {
      intake.addReference();
    }
    expect(intake.draft().references).toHaveLength(INTAKE_MAX_REFERENCES);

    for (let index = 0; index < INTAKE_MAX_REFERENCES + 5; index += 1) {
      intake.removeReference(0);
    }
    expect(intake.draft().references).toEqual(Array(INTAKE_MIN_REFERENCES).fill(''));
  });

  it('edits links: adds up to the limit and never leaves the list empty', () => {
    for (let index = 0; index < INTAKE_MAX_LINKS + 3; index += 1) {
      intake.addLink();
    }
    expect(intake.draft().links).toHaveLength(INTAKE_MAX_LINKS);

    for (let index = 0; index < INTAKE_MAX_LINKS + 3; index += 1) {
      intake.removeLink(0);
    }
    expect(intake.draft().links).toEqual(['']);
  });

  it('asks for the month review from the previous request and sends the review flag', async () => {
    vi.spyOn(TestBed.inject(Sync), 'pull').mockResolvedValue();
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(request({ status: 'ready', readyAt: '2026-10-23T10:00:00Z' }));
    await pending;

    intake.askForReview();

    expect(intake.reviewing()).toBe(true);
    expect(intake.draft().goals).toEqual(['reach', 'check']);
    const sending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).toMatchObject({ review: true });
    sent.flush(request({ review: true }));
    await sending;

    expect(intake.reviewWaiting()).toBe(true);
    expect(intake.reviewing()).toBe(true);
    expect(intake.reviewMode()).toBe(false);
  });

  it('sends the month numbers with the review request and refuses garbage', async () => {
    vi.spyOn(TestBed.inject(Sync), 'pull').mockResolvedValue();
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(request({ status: 'ready', readyAt: '2026-10-23T10:00:00Z' }));
    await pending;
    intake.askForReview();

    intake.setStat('followers', '12 abc');
    expect(intake.statsValid()).toBe(false);
    expect(intake.canSubmit()).toBe(false);
    intake.setStat('followers', ' 340 ');
    intake.setStat('reach', '');
    intake.setStat('bestPost', ' Сторис про спину ');
    expect(intake.canSubmit()).toBe(true);

    const sending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).toMatchObject({
      review: true,
      stats: { followers: 340, bestPost: 'Сторис про спину' },
    });
    expect((sent.request.body as { stats: object }).stats).not.toHaveProperty('reach');
    sent.flush(request({ review: true, stats: { followers: 340, bestPost: 'Сторис про спину' } }));
    await sending;

    intake.edit();
    expect(intake.draft().stats).toEqual({
      followers: '340',
      reach: '',
      bestPost: 'Сторис про спину',
    });
  });

  it('does not send empty numbers and never sends them outside the review', async () => {
    fillDraft();
    intake.setStat('followers', '100');

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).not.toHaveProperty('stats');
    sent.flush(request());
    await pending;
  });

  it('does not mark an ordinary request as a review', async () => {
    fillDraft();

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).not.toHaveProperty('review');
    sent.flush(request());
    await pending;

    expect(intake.reviewing()).toBe(false);
    expect(intake.reviewWaiting()).toBe(false);
  });

  it('leaves the review mode when the form is cancelled', async () => {
    vi.spyOn(TestBed.inject(Sync), 'pull').mockResolvedValue();
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(request({ status: 'ready', readyAt: '2026-10-23T10:00:00Z' }));
    await pending;
    intake.askForReview();

    intake.cancelEdit();

    expect(intake.reviewMode()).toBe(false);
    expect(intake.reviewing()).toBe(false);
  });

  it('sends the city and the time zone of the device with the request', async () => {
    fillDraft();
    intake.setCity('  Иркутск ');

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });

    expect(sent.request.body).toMatchObject({ city: 'Иркутск' });
    expect((sent.request.body as { timeZone?: string }).timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    sent.flush(request({ city: 'Иркутск' }));
    await pending;
  });

  it('refills the city from the previous request', async () => {
    vi.spyOn(TestBed.inject(Sync), 'pull').mockResolvedValue();
    const pending = intake.refresh();
    http
      .expectOne({ method: 'GET', url: intakeUrl })
      .flush(request({ status: 'ready', readyAt: '2026-10-23T10:00:00Z', city: 'Иркутск' }));
    await pending;

    intake.startNew();

    expect(intake.draft().city).toBe('Иркутск');
  });

  it('can be sent without a city: the place may be written in the wishes', async () => {
    fillDraft();

    expect(intake.canSubmit()).toBe(true);
  });

  it('sends the preferred days and times, keeps them for a new request and refuses a broken time', async () => {
    fillDraft();
    intake.toggleShootDay(3);
    intake.toggleShootDay(1);
    intake.setTime('shootTime', '11:00');
    intake.setTime('publishTime', '19:3');
    expect(intake.scheduleValid()).toBe(false);
    expect(intake.canSubmit()).toBe(false);
    intake.setTime('publishTime', '19:30');
    expect(intake.canSubmit()).toBe(true);

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    const schedule = { shootDays: [1, 3], shootTime: '11:00', publishTime: '19:30' };
    expect(sent.request.body).toMatchObject({ schedule });
    sent.flush(request({ status: 'ready', readyAt: '2026-10-23T10:00:00Z', schedule }));
    await pending;

    intake.startNew();
    expect(intake.draft().schedule).toEqual(schedule);
  });

  it('does not send the schedule when nothing is chosen', async () => {
    fillDraft();
    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).not.toHaveProperty('schedule');
    sent.flush(request());
    await pending;
  });
});
