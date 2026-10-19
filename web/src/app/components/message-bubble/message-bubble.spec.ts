import { TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../models';
import { MessageBubble } from './message-bubble';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'user',
    text: 'Анна',
    attachments: [],
    createdAt: new Date(2026, 9, 19, 12, 0),
    ...overrides,
  };
}

function render(value: ChatMessage, locked = false) {
  const fixture = TestBed.createComponent(MessageBubble);
  fixture.componentRef.setInput('message', value);
  fixture.componentRef.setInput('locked', locked);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const labels = () =>
    Array.from(element.querySelectorAll('button')).map((button) => button.textContent?.trim());
  return { fixture, element, labels };
}

describe('MessageBubble actions', () => {
  it('offers to edit an accepted answer and hides the delete button', () => {
    const { labels } = render(message({ answerFor: 'name' }));

    expect(labels()).toContain('Изменить');
    expect(labels()).not.toContain('Удалить');
  });

  it('does not offer to delete a question of the bot', () => {
    const { labels } = render(message({ role: 'assistant', onboarding: true }));

    expect(labels()).not.toContain('Удалить');
    expect(labels()).not.toContain('Изменить');
  });

  it('keeps the delete button for an ordinary message', () => {
    const { labels } = render(message({ role: 'assistant' }));

    expect(labels()).toContain('Удалить');
    expect(labels()).not.toContain('Изменить');
  });

  it('keeps the delete button for a rejected answer', () => {
    const { labels } = render(message({}));

    expect(labels()).toContain('Удалить');
  });

  it('emits the edit request and disables the button while locked', () => {
    const { fixture, element } = render(message({ answerFor: 'name' }));
    const requested = vi.fn();
    fixture.componentInstance.editRequested.subscribe(requested);
    const edit = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Изменить',
    );

    edit?.click();
    expect(requested).toHaveBeenCalledTimes(1);

    const locked = render(message({ answerFor: 'name' }), true);
    const lockedEdit = Array.from(locked.element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Изменить',
    );
    expect(lockedEdit?.disabled).toBe(true);
  });
});
