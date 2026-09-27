import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { splitBlock } from 'prosemirror-commands';
import { FormField, form } from '@angular/forms/signals';
import { ChatInput, ChatInputField } from './chat-input';

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

// The behaviour alone, on an element of the host's own.
@Component({
  imports: [ChatInputField],
  template: `
    <p
      emailChatInput
      #field="emailChatInput"
      placeholder="Ask…"
      [(value)]="value"
      (sent)="sent.push($event)"
      (touch)="touched = touched + 1"
    ></p>
  `,
})
class Bare {
  readonly value = signal('');
  readonly sent: string[] = [];
  touched = 0;
  readonly field = viewChild.required<ChatInputField>('field');
}

describe('ChatInputField', () => {
  let fixture: ComponentFixture<Bare>;
  let host: Bare;

  const editor = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'p > .email-chat-input__editor',
    )!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Bare] }).compileComponents();
    fixture = TestBed.createComponent(Bare);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('mounts the field into the host’s element, sends on Enter, and says when focus leaves', async () => {
    expect(editor()).not.toBeNull();
    expect(
      editor().querySelector('.email-chat-input__empty')?.getAttribute('data-placeholder'),
    ).toBe('Ask…');
    const view = host.field().editor()!.view;
    view.dispatch(view.state.tr.insertText('Shorter'));
    await fixture.whenStable();
    expect(host.value()).toBe('Shorter');
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(host.sent).toEqual(['Shorter']);
    editor().dispatchEvent(new FocusEvent('blur'));
    expect(host.touched).toBe(1);
    host.field().reset();
    await fixture.whenStable();
    expect(host.value()).toBe('');
  });
});

// As a signal-forms control: the form holds the message, the field shows
// and edits it — through the styled component, whose host directive is
// the control.
@Component({
  imports: [ChatInput, FormField],
  template: `<div email-chat-input [formField]="chat.message"></div>`,
})
class InForm {
  readonly model = signal({ message: '' });
  readonly chat = form(this.model);
  readonly input = viewChild.required(ChatInput);
}

describe('ChatInput in a signal form', () => {
  it('drives the field’s value both ways, and marks it touched on blur', async () => {
    await TestBed.configureTestingModule({ imports: [InForm] }).compileComponents();
    const fixture = TestBed.createComponent(InForm);
    const host = fixture.componentInstance;
    await fixture.whenStable();
    const editor = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.email-chat-input__editor',
    )!;
    const view = host.input().editor()!.view;
    view.dispatch(view.state.tr.insertText('Make it'));
    await fixture.whenStable();
    expect(host.model().message).toBe('Make it');
    expect(host.chat.message().touched()).toBe(false);
    editor.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(host.chat.message().touched()).toBe(true);
    host.chat.message().value.set('- short');
    await fixture.whenStable();
    expect(editor.querySelectorAll('li').length).toBe(1);
    fixture.destroy();
  });
});
