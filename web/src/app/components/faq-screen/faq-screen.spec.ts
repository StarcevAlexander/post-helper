import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FAQ_ITEMS, FAQ_TEXTS } from '../../constants';
import { FaqScreen } from './faq-screen';

describe('FaqScreen', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('lists every question with its answer and a way to write to us', async () => {
    const fixture = TestBed.createComponent(FaqScreen);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('details.item')).toHaveLength(FAQ_ITEMS.length);
    expect(element.textContent).toContain('Не приходят пуш-уведомления');
    expect(element.textContent).toContain('экран «Домой»');
    expect(element.querySelector('a.screen__primary')?.textContent).toContain(
      FAQ_TEXTS.feedbackLink,
    );
  });

  it('keeps the Instagram note with the asterisk in the answers', async () => {
    const fixture = TestBed.createComponent(FaqScreen);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Meta');
  });
});
