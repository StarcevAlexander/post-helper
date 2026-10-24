import { PublicationKit } from '../models';
import { captionWithHashtags } from './kit-text';

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
});
