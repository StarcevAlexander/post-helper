import { OnboardingStep } from '../models';
import { ONBOARDING_STEPS } from '../constants';
import { validateAnswer } from './answer-validation';

function stepOf(field: OnboardingStep['field']): OnboardingStep {
  const step = ONBOARDING_STEPS.find((candidate) => candidate.field === field);
  if (!step) {
    throw new Error(`no step ${field}`);
  }
  return step;
}

describe('validateAnswer', () => {
  it.each([
    ['name', 'Анна'],
    ['name', 'Анна-Мария'],
    ['specialty', 'маникюр'],
    ['specialty', 'маникюр и педикюр'],
    ['specialty', 'брови, ресницы'],
    ['city', 'Уфа'],
    ['city', 'Санкт-Петербург'],
    ['experience', '5 лет'],
    ['experience', 'Двенадцать лет, ученица школы Nail Art'],
    ['services', 'маникюр 2000, покрытие 2500'],
    ['clients', 'женщины 25-45, хотят быстро и аккуратно'],
    ['goal', 'больше записей'],
    ['instagram', 'anna_nails'],
    ['instagram', '@anna.nails'],
    ['instagram', 'https://instagram.com/anna_nails/'],
    ['style', 'Привет! Давайте сделаем вам красивые ручки'],
  ] as const)('accepts a real answer for %s: %s', (field, text) => {
    expect(validateAnswer(stepOf(field), text)).toBeUndefined();
  });

  it.each([
    ['specialty', 'аааааааа'],
    ['specialty', 'фывапролд'],
    ['specialty', 'asdfghjkl'],
    ['specialty', 'йцукенгшщ'],
    ['specialty', 'ghjklzxcvb'],
    ['specialty', '12345'],
    ['specialty', '😀😀😀'],
    ['specialty', 'тест'],
    ['specialty', 'хз'],
    ['specialty', 'ыыыы ккккк'],
    ['specialty', 'пжщшкрн'],
    ['city', 'я'],
    ['experience', '555'],
    ['services', 'ничего'],
    ['goal', 'ннннн ррррр'],
    ['name', 'Анна123'],
    ['name', 'я хочу много денег очень'],
    ['instagram', 'мой инстаграм'],
    ['instagram', 'anna nails'],
    ['style', 'ку'],
  ] as const)('rejects a garbage answer for %s: %s', (field, text) => {
    expect(validateAnswer(stepOf(field), text)).toBeTruthy();
  });

  it('puts an example into the reason and offers to skip optional questions', () => {
    const reason = validateAnswer(stepOf('city'), 'я');

    expect(reason).toContain('Иркутск');
    expect(reason).toContain('пропустить');
  });

  it('suggests leaving the field empty instead of writing a skip word in the form', () => {
    const reason = validateAnswer(stepOf('city'), 'я', 'form');

    expect(reason).toContain('оставьте поле пустым');
    expect(reason).not.toContain('пропустить');
  });

  it('does not offer to skip the required question', () => {
    const reason = validateAnswer(stepOf('specialty'), 'хз');

    expect(reason).not.toContain('пропустить');
  });

  it('demands the required question when it is empty and allows empty optional ones', () => {
    expect(validateAnswer(stepOf('specialty'), '   ')).toBeTruthy();
    expect(validateAnswer(stepOf('city'), '   ')).toBeUndefined();
  });

  it('tolerates a single odd word inside a real sentence', () => {
    expect(
      validateAnswer(stepOf('experience'), 'Работаю 7 лет, люблю френч, фффф'),
    ).toBeUndefined();
  });
});
