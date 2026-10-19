import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_AUDIT_JOBS_PATH, API_DEV_URL, AUDIT_JOB_POLL_MS } from '../constants';
import { AuditJob, AuditResult } from '../models';
import { Access } from './access';
import { Audit } from './audit';
import { AuditJobs } from './audit-jobs';

const jobsUrl = `${API_DEV_URL}${API_AUDIT_JOBS_PATH}`;

const result: AuditResult = {
  summary: 'Профиль аккуратный',
  strengths: ['Стиль'],
  problems: [],
  fixes: ['Добавьте ссылку'],
  bioSuggestion: '',
  nameSuggestion: '',
  contentNotes: [],
  missing: [],
};

function job(overrides: Partial<AuditJob> = {}): AuditJob {
  return {
    id: 'j1',
    handle: 'anna_nails',
    status: 'queued',
    createdAt: '2026-10-19T08:00:00Z',
    ...overrides,
  };
}

describe('AuditJobs', () => {
  let jobs: AuditJobs;
  let audit: Audit;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    jobs = TestBed.inject(AuditJobs);
    audit = TestBed.inject(Audit);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
  });

  afterEach(() => {
    jobs.stop();
    http.verify();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('orders an analysis with the consent', async () => {
    const pending = jobs.order('anna_nails', true);
    const request = http.expectOne({ method: 'POST', url: jobsUrl });

    expect(request.request.body).toEqual({ handle: 'anna_nails', consent: true });
    request.flush(job());

    expect(await pending).toBe(true);
    expect(jobs.job()?.status).toBe('queued');
    expect(jobs.active()).toBe(true);
  });

  it('shows the server message when the order is refused', async () => {
    const pending = jobs.order('x', true);
    http
      .expectOne({ method: 'POST', url: jobsUrl })
      .flush({ error: 'Нужно согласие' }, { status: 400, statusText: 'Bad Request' });

    expect(await pending).toBe(false);
    expect(jobs.error()).toBe('Нужно согласие');
    expect(jobs.job()).toBeUndefined();
  });

  it('takes no job when the server has none', async () => {
    const pending = jobs.refresh();
    http
      .expectOne({ method: 'GET', url: `${jobsUrl}/latest` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await pending;

    expect(jobs.job()).toBeUndefined();
    expect(jobs.active()).toBe(false);
  });

  it('asks again later while the job is not finished', async () => {
    vi.useFakeTimers();
    const pending = jobs.refresh();
    http.expectOne({ method: 'GET', url: `${jobsUrl}/latest` }).flush(job({ status: 'running' }));
    await pending;

    vi.advanceTimersByTime(AUDIT_JOB_POLL_MS);

    http
      .expectOne({ method: 'GET', url: `${jobsUrl}/latest` })
      .flush(job({ status: 'failed', error: 'Профиль закрытый' }));
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(AUDIT_JOB_POLL_MS * 2);

    expect(jobs.job()?.error).toBe('Профиль закрытый');
    expect(jobs.active()).toBe(false);
  });

  it('adopts the finished result once', async () => {
    const pending = jobs.refresh();
    http
      .expectOne({ method: 'GET', url: `${jobsUrl}/latest` })
      .flush(job({ status: 'done', result }));
    await pending;

    expect(audit.stored()?.jobId).toBe('j1');
    expect(audit.stored()?.result.summary).toBe('Профиль аккуратный');
    const saved = audit.stored();

    const again = jobs.refresh();
    http
      .expectOne({ method: 'GET', url: `${jobsUrl}/latest` })
      .flush(job({ status: 'done', result }));
    await again;

    expect(audit.stored()).toBe(saved);
  });

  it('cancels the order and reloads its state', async () => {
    const first = jobs.refresh();
    http.expectOne({ method: 'GET', url: `${jobsUrl}/latest` }).flush(job());
    await first;

    const pending = jobs.cancel();
    http.expectOne({ method: 'POST', url: `${jobsUrl}/j1/cancel` }).flush({ canceled: true });
    await vi.waitFor(() =>
      http
        .expectOne({ method: 'GET', url: `${jobsUrl}/latest` })
        .flush(job({ status: 'canceled' })),
    );
    await pending;

    expect(jobs.job()?.status).toBe('canceled');
    expect(jobs.active()).toBe(false);
  });
});
