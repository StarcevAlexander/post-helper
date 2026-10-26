import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Media } from '../../services/media';
import { MediaNote } from './media-note';

describe('MediaNote', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(Media).stop();
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(MediaNote);
    fixture.componentRef.setInput('itemId', 'w1-mon');
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('shows the label, the hint and the saved text', async () => {
    TestBed.inject(Media).setNote('w1-mon', 'Мой текст');

    const { element } = await render();

    const area = element.querySelector('textarea')!;
    expect(element.querySelector('label')?.textContent).toContain(
      'Что хотите сказать в этой публикации',
    );
    expect(element.textContent).toContain('Я перепишу это в продающий текст');
    expect(area.value).toBe('Мой текст');
    expect(area.maxLength).toBe(1000);
    expect(area.getAttribute('aria-describedby')).toBe('media-note-hint-w1-mon');
  });

  it('saves what the master types', async () => {
    const { element } = await render();
    const area = element.querySelector('textarea')!;

    area.value = 'Свободно в пятницу';
    area.dispatchEvent(new Event('input'));

    expect(TestBed.inject(Media).noteFor('w1-mon')).toBe('Свободно в пятницу');
    expect(localStorage.getItem('helper.media-notes')).toContain('Свободно в пятницу');
  });
});
