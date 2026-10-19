import { AuditResult } from '../models';
import { MAX_AUDIT_DIGEST_RUNES } from '../constants';
import { buildAuditDigest } from './audit-digest';

const result: AuditResult = {
  summary: 'Профиль аккуратный, но без призыва записаться.',
  strengths: ['Единый светлый стиль'],
  problems: ['Нет ссылки', 'Имя без ключевого слова'],
  fixes: ['Добавьте ссылку', 'Переименуйте профиль'],
  bioSuggestion: 'Маникюр в Иркутске. Запись по ссылке',
  nameSuggestion: 'Анна | Маникюр Иркутск',
  contentNotes: ['Нерегулярные публикации'],
  missing: ['Не видно статистики'],
};

describe('buildAuditDigest', () => {
  it('puts the verdict, the weak spots, the suggestions and the fixes into one text', () => {
    const digest = buildAuditDigest(result);

    expect(digest).toContain('Профиль аккуратный');
    expect(digest).toContain('Сильные стороны: Единый светлый стиль.');
    expect(digest).toContain('Слабые места: Нет ссылки; Имя без ключевого слова.');
    expect(digest).toContain('Предложенное имя профиля: Анна | Маникюр Иркутск.');
    expect(digest).toContain('Предложенная шапка: Маникюр в Иркутске. Запись по ссылке.');
    expect(digest).toContain('Правки: Добавьте ссылку; Переименуйте профиль.');
  });

  it('leaves out the parts that are empty', () => {
    const digest = buildAuditDigest({
      ...result,
      strengths: [],
      problems: [],
      bioSuggestion: '',
      nameSuggestion: '',
    });

    expect(digest).not.toContain('Сильные стороны');
    expect(digest).not.toContain('Слабые места');
    expect(digest).not.toContain('Предложенное имя');
    expect(digest).not.toContain('Предложенная шапка');
    expect(digest).toContain('Правки');
  });

  it('keeps the text within the limit the server accepts', () => {
    const digest = buildAuditDigest({
      ...result,
      fixes: Array.from({ length: 7 }, () => 'очень длинная правка '.repeat(20)),
    });

    expect(Array.from(digest).length).toBeLessThanOrEqual(MAX_AUDIT_DIGEST_RUNES);
    expect(digest.endsWith('…')).toBe(true);
  });
});
