import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { CALENDAR_STORAGE_KEY, MONTH_REVIEWS_STORAGE_KEY } from '../../constants';
import { IntakeRequest, MonthReview } from '../../models';
import { Intake } from '../../services/intake';
import { addDays, toDateKey } from '../../utils/date-utils';
import { MonthReviewScreen } from './month-review-screen';

const delivered: MonthReview = {
  id: 'm1',
  from: '2026-10-20',
  to: '2026-11-16',
  planned: 16,
  done: 12,
  headline: 'Выполнено 12 из 16',
  facts: ['Подписчиков 340, было 310'],
  conclusions: ['Сторис про спину дали больше всего ответов'],
  changes: ['Добавляем рубрику про осанку'],
  note: 'Отличный месяц',
};

function planEndingIn(days: number): void {
  localStorage.setItem(
    CALENDAR_STORAGE_KEY,
    JSON.stringify({
      schedule: { slots: [{ weekday: 1, time: '11:00' }], publishTime: '19:00' },
      items: [
        {
          id: 'm1-w4',
          date: toDateKey(addDays(new Date(), days)),
          time: '19:00',
          format: 'post',
          pillar: 'Процесс',
          idea: 'Кадр',
          done: false,
        },
      ],
      startedOn: toDateKey(new Date()),
    }),
  );
}

describe('MonthReviewScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(MonthReviewScreen);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('says that there are no reviews yet', async () => {
    const { element } = await render();

    expect(element.textContent).toContain('Итогов пока нет');
    expect(element.querySelector('.screen__primary')).toBeNull();
  });

  it('shows a delivered review with its numbers, conclusions and changes', async () => {
    localStorage.setItem(MONTH_REVIEWS_STORAGE_KEY, JSON.stringify([delivered]));

    const { element } = await render();

    const text = element.textContent ?? '';
    expect(text).toContain('Выполнено 12 из 16');
    expect(text).toContain('Подписчиков 340, было 310');
    expect(text).toContain('Сторис про спину дали больше всего ответов');
    expect(text).toContain('Добавляем рубрику про осанку');
    expect(text).toContain('Отличный месяц');
    expect(text).toContain('20 октября');
  });

  it('offers to ask for the review when the calendar is about to end', async () => {
    planEndingIn(1);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { element } = await render();

    const button = element.querySelector<HTMLButtonElement>('.screen__primary');
    expect(button?.textContent).toContain('Запросить итоги');
    button?.click();

    const intake = TestBed.inject(Intake);
    expect(intake.reviewMode()).toBe(true);
    expect(intake.editing()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/intake');
  });

  it('does not offer it while the month is far from the end', async () => {
    planEndingIn(12);

    const { element } = await render();

    expect(element.querySelector('.screen__primary')).toBeNull();
  });

  it('tells that the request has been sent instead of offering it again', async () => {
    planEndingIn(1);
    const request: IntakeRequest = {
      id: 'i2',
      networks: [],
      goals: ['reach'],
      status: 'new',
      review: true,
      createdAt: '2026-11-14T10:00:00Z',
      updatedAt: '2026-11-14T10:00:00Z',
    };

    const { fixture, element } = await render();
    TestBed.inject(Intake).request.set(request);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.textContent).toContain('Запрос отправлен');
    expect(element.querySelector('.screen__primary')).toBeNull();
  });
});
