import { TestBed } from '@angular/core/testing';
import { ImageCompressor } from './image-compressor';

describe('ImageCompressor', () => {
  let compressor: ImageCompressor;

  beforeEach(() => {
    compressor = TestBed.inject(ImageCompressor);
  });

  it('returns non-image files untouched', async () => {
    const file = new File(['текст'], 'notes.txt', { type: 'text/plain' });

    expect(await compressor.prepare(file)).toBe(file);
  });

  it('returns gifs untouched', async () => {
    const file = new File(['gif'], 'a.gif', { type: 'image/gif' });

    expect(await compressor.prepare(file)).toBe(file);
  });

  it('falls back to the original image when it cannot be decoded', async () => {
    const file = new File(['not an image'], 'broken.jpg', { type: 'image/jpeg' });

    expect(await compressor.prepare(file)).toBe(file);
  });
});
