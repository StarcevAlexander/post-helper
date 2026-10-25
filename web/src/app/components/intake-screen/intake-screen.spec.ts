import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_DEV_URL, API_INTAKE_PATH, INTAKE_GOALS, INTAKE_TEXTS } from '../../constants';
import { IntakeRequest } from '../../models';
import { Access } from '../../services/access';
import { Account } from '../../services/account';
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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
    TestBed.inject(Account).info.set({ name: 'Анна', retentionDays: 1095 });
    const fixture = TestBed.createComponent(IntakeScreen);
    await fixture.whenStable();
    intake.loaded.set(true);
    await fixture.whenStable();
    return fixture;
  }

  function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    element.value = value;
    element.dispatchEvent(new Event('input'));
  }

  it('hides the form and offers a retry while the server is unreachable', async () => {
    const fixture = TestBed.createComponent(IntakeScreen);
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('textarea')).toBeNull();
    expect(html.textContent).toContain(INTAKE_TEXTS.connecting);
    const retry = html.querySelector<HTMLButtonElement>('.screen__secondary');
    expect(retry?.textContent).toContain(INTAKE_TEXTS.retry);
  });

  it('offers every goal and a field for wishes and recommendations', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelectorAll('.goal input[type="checkbox"]')).toHaveLength(INTAKE_GOALS.length);
    expect(html.textContent).toContain(INTAKE_TEXTS.noteTitle);
    expect(html.querySelector('textarea')).not.toBeNull();
    expect(html.querySelector<HTMLButtonElement>('.screen__primary')?.disabled).toBe(true);
  });

  it('offers five reference fields and adds more on demand', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.textContent).toContain(INTAKE_TEXTS.referencesTitle);
    expect(html.querySelectorAll('[id^="intake-reference-"]')).toHaveLength(5);

    const add = Array.from(html.querySelectorAll<HTMLButtonElement>('.screen__secondary')).find(
      (button) => button.textContent?.includes(INTAKE_TEXTS.addReference),
    )!;
    add.click();
    fixture.detectChanges();

    expect(html.querySelectorAll('[id^="intake-reference-"]')).toHaveLength(6);
  });

  it('names the network under the pasted link', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    type(html.querySelector<HTMLInputElement>('#intake-link-0')!, 'https://t.me/anna');
    fixture.detectChanges();

    expect(html.querySelector('.link__platform')?.textContent).toContain('Telegram');
  });

  it('marks Instagram with an asterisk and explains it next to the links and the references', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    type(html.querySelector<HTMLInputElement>('#intake-link-0')!, 'instagram.com/anna');
    fixture.detectChanges();

    expect(html.querySelector('.link__platform')?.textContent).toContain('Instagram*');
    const notes = Array.from(html.querySelectorAll('.screen__hint')).filter((hint) =>
      hint.textContent?.includes('Meta'),
    );
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toContain('запрещённой');
    expect(html.textContent).toContain('Instagram*, ВКонтакте');
  });

  it('sends the link, the chosen goals and the wishes', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    type(html.querySelector<HTMLInputElement>('#intake-link-0')!, 'vk.com/anna');
    type(html.querySelector<HTMLInputElement>('#intake-reference-1')!, 'instagram.com/ref_one');
    html.querySelectorAll<HTMLInputElement>('.goal input')[0].click();
    html.querySelectorAll<HTMLInputElement>('.goal input')[3].click();
    type(html.querySelector('textarea')!, 'Не показывать лицо');
    fixture.detectChanges();
    const submit = html.querySelector<HTMLButtonElement>('.screen__primary')!;
    expect(submit.disabled).toBe(false);
    submit.click();

    const request = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(request.request.body).toMatchObject({
      links: ['vk.com/anna'],
      references: ['instagram.com/ref_one'],
      goals: ['reach', 'check'],
      note: 'Не показывать лицо',
      city: '',
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

  it('asks where the master works and allows to leave the city for the wishes', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('#intake-city')).not.toBeNull();
    expect(html.textContent).toContain(INTAKE_TEXTS.cityTitle);
    expect(html.textContent).toContain('Это поле можно не заполнять');
    expect(html.textContent?.match(/в каком городе или посёлке/g) ?? []).toHaveLength(0);
  });

  it('sends the typed city and shows it in the sent request', async () => {
    const fixture = await render();
    const html = fixture.nativeElement as HTMLElement;

    type(html.querySelector<HTMLInputElement>('#intake-link-0')!, 'vk.com/anna');
    html.querySelectorAll<HTMLInputElement>('.goal input')[0].click();
    type(html.querySelector<HTMLInputElement>('#intake-city')!, 'Иркутск');
    fixture.detectChanges();
    html.querySelector<HTMLButtonElement>('.screen__primary')!.click();

    const request = http.expectOne({ method: 'POST', url: intakeUrl });
    expect(request.request.body).toMatchObject({ city: 'Иркутск' });
    request.flush({ ...sent(), city: 'Иркутск' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(html.textContent).toContain('Населённый пункт');
    expect(html.textContent).toContain('Иркутск');
  });

  it('lets the master pick shooting days and times and shows them in the sent request', async () => {
    const fixture = await render();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const tuesday = element.querySelector<HTMLButtonElement>('button.day[aria-label="Вторник"]');
    expect(tuesday).not.toBeNull();
    tuesday?.click();
    fixture.detectChanges();
    expect(tuesday?.getAttribute('aria-pressed')).toBe('true');
    expect(intake.draft().schedule.shootDays).toEqual([1]);
    const publish = element.querySelector<HTMLInputElement>('#intake-publish-time');
    expect(publish).not.toBeNull();
    if (publish) {
      publish.value = '19:30';
      publish.dispatchEvent(new Event('input'));
    }
    expect(intake.draft().schedule.publishTime).toBe('19:30');

    intake.request.set(sent({ schedule: { shootDays: [1, 3], publishTime: '19:30' } }));
    intake.cancelEdit();
    fixture.detectChanges();
    expect(element.textContent).toContain('Дни съёмки: Вторник, Четверг');
    expect(element.textContent).toContain('Публикации: 19:30');
  });
});
