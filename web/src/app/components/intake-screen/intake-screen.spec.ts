import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_DEV_URL, API_INTAKE_PATH, INTAKE_GOALS, INTAKE_TEXTS } from '../../constants';
import { IntakeRequest } from '../../models';
import { Access } from '../../services/access';
import { Intake } from '../../services/intake';
import { IntakeScreen } from './intake-screen';

const intakeUrl = `${API_DEV_URL}${API_INTAKE_PATH}`;

function sent(overrides: Partial<IntakeRequest> = {}): IntakeRequest {
  return {
    id: 'r1',
    networks: [{ platform: 'vk', url: 'https://vk.com/anna' }],
    goals: ['reach'],
    note: 'Не показывать лицо',
    status: 'new',
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:00Z',
    ...overrides,
  };
}

describe('IntakeScreen', () => {
  let intake: Intake;
  let http: HttpTestingController;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
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
  });

  async function render() {
    const fixture = TestBed.createComponent(IntakeScreen);
    intake.show();
    await fixture.whenStable();
    return fixture;
  }

  function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    element.value = value;
    element.dispatchEvent(new Event('input'));
  }

  it('offers every goal and a field for wishes and recommendations', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelectorAll('.goal input[type="checkbox"]')).toHaveLength(INTAKE_GOALS.length);
    expect(html.textContent).toContain(INTAKE_TEXTS.noteTitle);
    expect(html.querySelector('textarea')).not.toBeNull();
    expect(html.querySelector<HTMLButtonElement>('.screen__primary')?.disabled).toBe(true);
  });

  it('names the network under the pasted link', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    type(html.querySelector<HTMLInputElement>('#intake-link-0')!, 'https://t.me/anna');
    fixture.detectChanges();

    expect(html.querySelector('.link__platform')?.textContent).toContain('Telegram');
  });

  it('sends the link, the chosen goals and the wishes', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    type(html.querySelector<HTMLInputElement>('#intake-link-0')!, 'vk.com/anna');
    html.querySelectorAll<HTMLInputElement>('.goal input')[0].click();
    html.querySelectorAll<HTMLInputElement>('.goal input')[3].click();
    type(html.querySelector('textarea')!, 'Не показывать лицо');
    fixture.detectChanges();
    const submit = html.querySelector<HTMLButtonElement>('.screen__primary')!;
    expect(submit.disabled).toBe(false);
    submit.click();

    const request = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(request.request.body).toEqual({
      links: ['vk.com/anna'],
      goals: ['reach', 'check'],
      note: 'Не показывать лицо',
    });
    request.flush(sent());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(html.textContent).toContain(INTAKE_TEXTS.sentTitle);
    expect(html.textContent).toContain('Не показывать лицо');
  });

  it('shows the reply of the owner when the plan is ready', async () => {
    const fixture = await render();
    intake.request.set(
      sent({ status: 'ready', readyAt: '2026-10-23T10:00:00Z', replyNote: 'Учёл ваши пожелания' }),
    );
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.textContent).toContain(INTAKE_TEXTS.readyText);
    expect(html.textContent).toContain('Учёл ваши пожелания');
    expect(html.textContent).toContain(INTAKE_TEXTS.again);
  });
});
