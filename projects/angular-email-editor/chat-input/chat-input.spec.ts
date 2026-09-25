import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { splitBlock } from 'prosemirror-commands';
import { ChatInput } from './chat-input';

@Component({
  imports: [ChatInput],
  template: `
    <div
      email-chat-input
      #input
      placeholder="Tell the assistant…"
      label="Instructions"
      [(value)]="value"
      (sent)="sent.push($event)"
      (escaped)="escaped = escaped + 1"
    ></div>
  `,
})
class Host {
  readonly value = signal('');
  readonly sent: string[] = [];
  escaped = 0;
  readonly input = viewChild.required<ChatInput>('input');
}

describe('ChatInput', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const editor = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.email-chat-input__editor')!;
  const key = (key: string, init: KeyboardEventInit = {}) =>
    editor().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  /** Types: text into the document at the caret, through the editor inside. */
  const type = (text: string) => {
    const view = host.input().editor()!.view;
    view.dispatch(view.state.tr.insertText(text));
  };
  const settle = () => fixture.whenStable();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => fixture.destroy());

  it('is a labelled text box that says what it is for while empty', () => {
    expect(editor().getAttribute('role')).toBe('textbox');
    expect(editor().getAttribute('aria-label')).toBe('Instructions');
    const empty = editor().querySelector('.email-chat-input__empty');
    expect(empty?.getAttribute('data-placeholder')).toBe('Tell the assistant…');
  });

  it('carries its text out as lines, list items as dash lines', async () => {
    type('Make it');
    await settle();
    expect(host.value()).toBe('Make it');
    expect(editor().querySelector('.email-chat-input__empty')).toBeNull();
    // A new paragraph (Shift-Enter only breaks the line), made a list — as
    // `- ` would, through the input rule.
    host.input().editor()!.exec(splitBlock);
    host.input().editor()!.commands['toggleBulletList']();
    type('short');
    await settle();
    expect(editor().querySelector('ul')).not.toBeNull();
    expect(host.value()).toBe('Make it\n- short');
  });

  it('Enter sends outside a list, goes on to the next item inside one; Ctrl-Enter always sends', async () => {
    type('Make it short');
    key('Enter');
    expect(host.sent).toEqual(['Make it short']);
    host.input().clear();
    await settle();
    expect(host.value()).toBe('');
    host.input().editor()!.commands['toggleBulletList']();
    type('short');
    key('Enter');
    expect(host.sent).toEqual(['Make it short']); // a new item, not a send
    type('friendly');
    await settle();
    expect(host.value()).toBe('- short\n- friendly');
    key('Enter', { ctrlKey: true });
    expect(host.sent).toEqual(['Make it short', '- short\n- friendly']);
  });

  it('sends nothing empty, and says Escape', () => {
    key('Enter');
    expect(host.sent).toEqual([]);
    key('Escape');
    expect(host.escaped).toBe(1);
  });

  it('shows a value written from outside, dash lines as items', async () => {
    host.value.set('Make it\n- short');
    await settle();
    expect(editor().querySelectorAll('li').length).toBe(1);
    expect(editor().textContent).toContain('short');
  });
});
