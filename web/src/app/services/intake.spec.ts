import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_DEV_URL,
  API_INTAKE_PATH,
  INTAKE_MAX_LINKS,
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
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
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
    fillDraft();

    const pending = intake.submit();
    const sent = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(sent.request.body).toEqual({
      links: ['vk.com/anna'],
      goals: ['reach'],
      note: 'Не показывать лицо',
    });
    sent.flush(request());

    expect(await pending).toBe(true);
    expect(intake.pending()).toBe(true);
    expect(intake.showForm()).toBe(false);
  });

  it('keeps the form and shows the server message when sending fails', async () => {
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

    expect(intake.open()).toBe(true);
    expect(intake.loaded()).toBe(true);
    expect(intake.showForm()).toBe(true);
  });

  it('refills the form from a pending request and polls until it is ready', async () => {
    vi.useFakeTimers();
    const pending = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(request());
    await pending;
    expect(intake.open()).toBe(false);

    intake.edit();
    expect(intake.draft()).toEqual({
      links: ['https://vk.com/anna'],
      goals: ['reach', 'check'],
      note: 'Без танцев',
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

    const pending = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(ready);
    await pending;

    expect(intake.open()).toBe(true);
    expect(intake.ready()).toBe(true);
    expect(pull).toHaveBeenCalledTimes(1);

    intake.hide();
    expect(localStorage.getItem(INTAKE_SEEN_STORAGE_KEY)).toBe('2026-10-23T10:00:00Z');
    intake.open.set(false);
    const again = intake.refresh();
    http.expectOne({ method: 'GET', url: intakeUrl }).flush(ready);
    await again;
    expect(intake.open()).toBe(false);
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
      goals: ['reach', 'check'],
      note: '',
    });
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
});
