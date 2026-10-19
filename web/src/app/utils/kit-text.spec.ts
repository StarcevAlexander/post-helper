import { PublicationKit } from '../models';
import { captionWithHashtags, fullKitText } from './kit-text';

const kit: PublicationKit = {
  shots: ['Снять руки крупно', 'Включить дневной свет'],
  frames: [
    { visual: 'Руки с гель-лаком', overlay: 'Смотрите' },
    { visual: 'Результат', overlay: '' },
  ],
  caption: 'Показываю маникюр.',
  hashtags: ['#маникюр', '#иркутск'],
  tip: 'Спросите согласие клиента',
};

describe('kit text', () => {
  it('joins the caption and hashtags with an empty line', () => {
    expect(captionWithHashtags(kit)).toBe('Показываю маникюр.\n\n#маникюр #иркутск');
  });

  it('keeps just the hashtags when there is no caption', () => {
    expect(captionWithHashtags({ ...kit, caption: '' })).toBe('#маникюр #иркутск');
  });

  it('writes the whole kit as plain text with every section', () => {
    const text = fullKitText('Reels: Видео', 'reels', kit);

    expect(text.startsWith('Reels: Видео')).toBe(true);
    expect(text).toContain('Что снять:\n- Снять руки крупно\n- Включить дневной свет');
    expect(text).toContain('Сцена 1\nВ кадре: Руки с гель-лаком\nТекст на экране: Смотрите');
    expect(text).toContain('Сцена 2\nВ кадре: Результат');
    expect(text).not.toContain('Сцена 2\nВ кадре: Результат\nТекст на экране');
    expect(text).toContain('Подпись:\nПоказываю маникюр.');
    expect(text).toContain('Хэштеги:\n#маникюр #иркутск');
    expect(text).toContain('Подсказка: Спросите согласие клиента');
  });

  it('names the frames by format and skips empty sections', () => {
    const text = fullKitText('Сторис', 'stories', { ...kit, shots: [], caption: '', tip: '' });

    expect(text).toContain('Кадр 1');
    expect(text).not.toContain('Что снять');
    expect(text).not.toContain('Подпись');
    expect(text).not.toContain('Подсказка');
  });
});
