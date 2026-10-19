import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  API_AUDIT_PATH,
  API_DEV_URL,
  MAX_AUDIT_IMAGES,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
} from '../../constants';
import { AuditResult } from '../../models';
import { Access } from '../../services/access';
import { Audit } from '../../services/audit';
import { AuditScreen } from './audit-screen';

const auditUrl = `${API_DEV_URL}${API_AUDIT_PATH}`;

const result: AuditResult = {
  summary: 'Профиль аккуратный, но без призыва записаться.',
  strengths: ['Единый светлый стиль'],
  problems: ['Нет ссылки'],
  fixes: ['Добавьте ссылку'],
  bioSuggestion: 'Маникюр в Иркутске. Запись по ссылке',
  nameSuggestion: 'Анна | Маникюр Иркутск',
  contentNotes: ['Нерегулярные публикации'],
  missing: ['Не видно статистики'],
};

function image(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

describe('AuditScreen', () => {
  let audit: Audit;
  let http: HttpTestingController;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
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
    audit = TestBed.inject(Audit);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Access).save('ABCDE-FGHJK-LMNPQ-RSTUV');
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function open() {
    const fixture = TestBed.createComponent(AuditScreen);
    audit.show();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  async function pick(
    fixture: Awaited<ReturnType<typeof open>>['fixture'],
    element: HTMLElement,
    files: File[],
  ) {
    const input = element.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) {
      throw new Error('no file input');
    }
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => fixture.detectChanges());
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function submit(element: HTMLElement): HTMLButtonElement {
    const button = element.querySelector<HTMLButtonElement>('.screen__primary');
    if (!button) {
      throw new Error('no submit button');
    }
    return button;
  }

  it('explains what to shoot and starts with a disabled button', async () => {
    const { element } = await open();

    expect(element.querySelectorAll('.section__list li').length).toBe(7);
    expect(element.textContent).toContain('от 4 до 8 скриншотов');
    expect(element.textContent).toContain('лица и имена клиентов');
    expect(submit(element).disabled).toBe(true);
  });

  it('shows the chosen pictures and enables the button', async () => {
    const { fixture, element } = await open();

    await pick(fixture, element, [image('a.png'), image('b.png')]);

    expect(element.querySelectorAll('.thumb').length).toBe(2);
    expect(element.textContent).toContain('Выбрано: 2 из 8');
    expect(submit(element).disabled).toBe(false);
    expect(element.textContent).toContain('хотя бы 4 скриншота');
  });

  it('does not nag about the minimum once there are four pictures', async () => {
    const { fixture, element } = await open();

    await pick(fixture, element, [image('a.png'), image('b.png'), image('c.png'), image('d.png')]);

    expect(element.textContent).not.toContain('хотя бы 4 скриншота');
  });

  it('refuses a ninth picture and anything that is not a picture', async () => {
    const { fixture, element } = await open();
    const files = Array.from({ length: MAX_AUDIT_IMAGES + 2 }, (_, index) => image(`${index}.png`));

    await pick(fixture, element, files);

    expect(element.querySelectorAll('.thumb').length).toBe(MAX_AUDIT_IMAGES);
    expect(element.querySelector('.screen__error')?.textContent).toContain('не больше 8');

    const second = await open();
    await pick(second.fixture, second.element, [
      new File(['x'], 'note.txt', { type: 'text/plain' }),
    ]);
    expect(second.element.querySelector('.screen__error')?.textContent).toContain(
      'только картинки',
    );
  });

  it('removes a picture', async () => {
    const { fixture, element } = await open();
    await pick(fixture, element, [image('a.png'), image('b.png')]);

    element.querySelector<HTMLButtonElement>('.thumb__remove')?.click();
    fixture.detectChanges();

    expect(element.querySelectorAll('.thumb').length).toBe(1);
  });

  it('sends the pictures and shows the verdict with the copy buttons', async () => {
    const { fixture, element } = await open();
    await pick(fixture, element, [image('a.png'), image('b.png'), image('c.png'), image('d.png')]);

    submit(element).click();
    const request = http.expectOne(auditUrl);
    expect((request.request.body as FormData).getAll('images').length).toBe(4);
    request.flush(result);
    await vi.waitFor(() => expect(audit.busy()).toBe(false));
    await fixture.whenStable();
    fixture.detectChanges();

    const text = element.textContent ?? '';
    expect(text).toContain('Профиль аккуратный');
    expect(text).toContain('Единый светлый стиль');
    expect(text).toContain('Добавьте ссылку');
    expect(text).toContain('Анна | Маникюр Иркутск');
    expect(text).toContain('Маникюр в Иркутске. Запись по ссылке');
    expect(text).toContain('Не видно статистики');
    expect(text).toContain('Разбор учтён');
    expect(element.querySelector('input[type="file"]')).toBeNull();
  });

  it('shows the server explanation and keeps the pictures', async () => {
    const { fixture, element } = await open();
    await pick(fixture, element, [image('a.png')]);

    submit(element).click();
    http
      .expectOne(auditUrl)
      .flush({ error: 'Скриншоты не подошли: переснимите' }, { status: 422, statusText: 'x' });
    await vi.waitFor(() => expect(audit.busy()).toBe(false));
    fixture.detectChanges();

    expect(element.querySelector('.screen__error')?.textContent).toContain('переснимите');
    expect(element.querySelectorAll('.thumb').length).toBe(1);
  });

  async function withResult() {
    const pending = audit.analyze([image('a.png')]);
    http.expectOne(auditUrl).flush(result);
    await pending;
    return open();
  }

  it('copies the suggested header', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { fixture, element } = await withResult();

    const buttons = element.querySelectorAll<HTMLButtonElement>('.section .screen__secondary');
    buttons[1].click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('Маникюр в Иркутске. Запись по ссылке');
  });

  it('opens the form again for other screenshots and removes the verdict on request', async () => {
    const { fixture, element } = await withResult();
    const buttons = () =>
      Array.from(element.querySelectorAll<HTMLButtonElement>('.screen__body > button'));

    buttons()
      .find((button) => button.textContent?.includes('другие скриншоты'))
      ?.click();
    fixture.detectChanges();
    expect(element.querySelector('input[type="file"]')).toBeTruthy();
    expect(audit.stored()).toBeDefined();

    audit.clear();
    fixture.detectChanges();
    expect(element.querySelector('input[type="file"]')).toBeTruthy();
    expect(audit.stored()).toBeUndefined();
  });

  it('closes by clearing the open flag', async () => {
    const { fixture, element } = await open();

    element.querySelector<HTMLButtonElement>('.screen__close')?.click();
    await fixture.whenStable();

    expect(audit.open()).toBe(false);
  });
});
