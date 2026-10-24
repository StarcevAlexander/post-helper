import { TestBed } from '@angular/core/testing';
import { RECOMMENDATIONS_STORAGE_KEY } from '../../constants';
import { RecommendationsScreen } from './recommendations-screen';

const stored = [
  { id: 'r1', text: 'Обновить аватар', importance: 40, done: false },
  { id: 'r2', text: 'Добавить запись в шапку', importance: 90, done: true },
];

describe('RecommendationsScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(RecommendationsScreen);
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('says that there are no recommendations yet', async () => {
    const { element } = await render();

    expect(element.textContent).toContain('Рекомендаций пока нет');
    expect(element.querySelector('.item')).toBeNull();
  });

  it('shows the importance in percent, the most important first, and the progress', async () => {
    localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(stored));

    const { element } = await render();

    const items = element.querySelectorAll('.item');
    expect(items[0].textContent).toContain('Добавить запись в шапку');
    expect(items[0].textContent).toContain('Важность 90%');
    expect(items[1].textContent).toContain('Важность 40%');
    expect(element.querySelector('.screen__progress')?.textContent).toContain('Выполнено 1 из 2');
    expect(items[0].classList.contains('item--done')).toBe(true);
  });

  it('marks a recommendation as done by the checkbox', async () => {
    localStorage.setItem(RECOMMENDATIONS_STORAGE_KEY, JSON.stringify(stored));
    const { fixture, element } = await render();

    element.querySelectorAll<HTMLInputElement>('.item__check')[1].click();
    await fixture.whenStable();

    expect(element.querySelector('.screen__progress')?.textContent).toContain('Выполнено 2 из 2');
    expect(JSON.parse(localStorage.getItem(RECOMMENDATIONS_STORAGE_KEY) ?? '[]')[0].done).toBe(
      true,
    );
  });
});
