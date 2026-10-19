import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_AUDIT_PATH,
  API_DEV_URL,
  AUDIT_STORAGE_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
} from '../constants';
import { AuditResult } from '../models';
import { Access } from './access';
import { Audit } from './audit';
import { Onboarding } from './onboarding';

const auditUrl = `${API_DEV_URL}${API_AUDIT_PATH}`;

const result: AuditResult = {
  summary: 'Профиль аккуратный',
  strengths: ['Стиль'],
  problems: ['Нет ссылки'],
  fixes: ['Добавьте ссылку'],
  bioSuggestion: 'Маникюр в Иркутске',
  nameSuggestion: 'Анна | Маникюр',
  contentNotes: [],
  missing: [],
};

function image(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

describe('Audit', () => {
  let audit: Audit;
  let onboarding: Onboarding;
  let http: HttpTestingController;

  function setUp(complete = true): void {
    localStorage.clear();
    if (complete) {
      localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({
          index: ONBOARDING_STEPS.length,
          answers: { specialty: 'маникюр', city: 'Иркутск' },
          confirmed: false,
        }),
      );
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    audit = TestBed.inject(Audit);
    onboarding = TestBed.inject(Onboarding);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
  }

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('sends the profile and the pictures as a form', async () => {
    setUp();

    const pending = audit.analyze([image('a.png'), image('b.png')]);
    const request = http.expectOne(auditUrl);

    expect(request.request.headers.get('Authorization')).toBe('Bearer ABCDE-FGHJK-LMNPQ-RSTUV');
    const body = request.request.body as FormData;
    expect(JSON.parse(body.get('profile') as string)).toMatchObject({ specialty: 'маникюр' });
    expect(body.getAll('images').length).toBe(2);
    request.flush(result);
    expect(await pending).toBe(true);
  });

  it('stores the result and puts its digest into the profile', async () => {
    setUp();

    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush(result);
    await pending;

    expect(audit.stored()?.result.summary).toBe('Профиль аккуратный');
    expect(audit.stored()?.imageCount).toBe(1);
    expect(onboarding.answers().audit).toContain('Нет ссылки');
    expect(onboarding.profile()?.audit).toContain('Анна | Маникюр');
    expect(JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) ?? '{}').imageCount).toBe(1);
  });

  it('remembers the result in a new session', async () => {
    setUp();
    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush(result);
    await pending;

    TestBed.resetTestingModule();

    expect(TestBed.inject(Audit).stored()?.result.fixes).toEqual(['Добавьте ссылку']);
  });

  it('shows the server explanation when the screenshots do not fit', async () => {
    setUp();

    const pending = audit.analyze([image('a.png')]);
    http
      .expectOne(auditUrl)
      .flush(
        { error: 'Скриншоты не подошли: слишком тёмные' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );

    expect(await pending).toBe(false);
    expect(audit.error()).toContain('слишком тёмные');
    expect(audit.stored()).toBeUndefined();
    expect(audit.busy()).toBe(false);
  });

  it('signs out when the code is refused', async () => {
    setUp();

    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush({ error: 'Неверный код' }, { status: 401, statusText: 'x' });
    await pending;

    expect(TestBed.inject(Access).granted()).toBe(false);
  });

  it('does nothing without pictures, without a finished questionnaire or while busy', async () => {
    setUp();
    expect(await audit.analyze([])).toBe(false);

    const first = audit.analyze([image('a.png')]);
    expect(await audit.analyze([image('b.png')])).toBe(false);
    http.expectOne(auditUrl).flush(result);
    await first;

    TestBed.resetTestingModule();
    setUp(false);
    expect(await audit.analyze([image('a.png')])).toBe(false);
    expect(audit.error()).toContain('анкет');
  });

  it('removes the result and its digest on clear', async () => {
    setUp();
    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush(result);
    await pending;

    audit.clear();

    expect(audit.stored()).toBeUndefined();
    expect(onboarding.answers().audit).toBeUndefined();
    expect(localStorage.getItem(AUDIT_STORAGE_KEY)).toBeNull();
  });

  it('forgets the result on reset but leaves the profile alone', async () => {
    setUp();
    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush(result);
    await pending;

    audit.reset();

    expect(audit.stored()).toBeUndefined();
    expect(localStorage.getItem(AUDIT_STORAGE_KEY)).toBeNull();
  });

  it('ignores a corrupted store', () => {
    setUp();
    localStorage.setItem(AUDIT_STORAGE_KEY, '{not json');
    TestBed.resetTestingModule();
    expect(TestBed.inject(Audit).stored()).toBeUndefined();

    localStorage.setItem(
      AUDIT_STORAGE_KEY,
      JSON.stringify({ createdAt: 'x', imageCount: 1, result: {} }),
    );
    TestBed.resetTestingModule();
    expect(TestBed.inject(Audit).stored()).toBeUndefined();
  });

  it('keeps the digest when the profile questionnaire is saved again', async () => {
    setUp();
    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush(result);
    await pending;

    onboarding.saveDraft({ ...onboarding.toDraft(), city: 'Ангарск' });

    expect(onboarding.answers().city).toBe('Ангарск');
    expect(onboarding.answers().audit).toContain('Нет ссылки');
  });
});
