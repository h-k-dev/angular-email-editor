import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';

import {
  Editor,
  createContentProposal,
  createContentStream,
  createEditor,
  emailExtensions,
  isProposing,
} from 'angular-email-editor';

import { Ai, AiOptions, AiRequest } from '../../../../services/ai';
import { FormattingCommands } from '../formatting-commands';
import { createAiWriter } from '../ai-writer';
import { Popover } from '../popover/popover';
import { ChatBasedSuggestion } from './chat-based-suggestion';

// jsdom lacks what the editor needs at mount (see compose.spec.ts).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** A composer's worth: the commands, the bar, and an email editor with
    the `ai` action, the stream and the proposal in its kit. */
@Component({
  imports: [ChatBasedSuggestion],
  providers: [FormattingCommands, Popover],
  template: `
    <div #host></div>
    <div chat-based-suggestion [language]="language"></div>
  `,
})
class Host {
  readonly language = () => 'de' as const;
  readonly commands = inject(FormattingCommands);
  readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  readonly panel = viewChild.required(ChatBasedSuggestion);
  editor!: Editor;

  constructor() {
    this.commands.connect({
      codeView: signal(false),
      codeEditor: signal(undefined),
      openLink: () => undefined,
      openAltText: () => undefined,
    });
    afterNextRender(() => {
      this.editor = createEditor({
        parent: this.host().nativeElement,
        extensions: [
          createAiWriter({ onAsk: (ask) => this.panel().show(ask) }),
          // Written the moment it comes, so the spec reads it at once.
          createContentStream({ reveal: 'instant' }),
          createContentProposal(),
          ...emailExtensions,
        ],
        content: '<div>We met last week.</div>',
      });
      const end = this.editor.state.doc.content.size - 1;
      this.editor.view.dispatch(
        this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, end)),
      );
      // jsdom has no layout: Apply scrolls the caret into view, which
      // measures — from a rect the spec supplies.
      vi.spyOn(this.editor.view, 'coordsAtPos').mockReturnValue({
        left: 40,
        right: 40,
        top: 100,
        bottom: 120,
      });
      this.commands.mount(this.editor);
    });
  }
}

describe('ChatBasedSuggestion', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let asked: AiRequest[];
  let aborted: number;
  /** The assistant's pieces, handed over one at a time by the spec. */
  let feed: (piece: string | null) => Promise<void>;

  const ai = {
    write: async function* (request: AiRequest, { signal }: AiOptions = {}) {
      asked.push(request);
      signal?.addEventListener('abort', () => aborted++);
      const waiting: Array<(piece: string | null) => void> = [];
      const ready: Array<string | null> = [];
      feed = async (piece) => {
        const next = waiting.shift();
        if (next) next(piece);
        else ready.push(piece);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await fixture.whenStable();
      };
      while (true) {
        const piece = ready.length
          ? ready.shift()!
          : await new Promise<string | null>((resolve) => waiting.push(resolve));
        if (piece === null || signal?.aborted) return;
        yield piece;
      }
    },
  } as unknown as Ai;

  const ORIGINAL = '<div>We met last week.</div>';
  const dialog = () =>
    document.querySelector<HTMLElement>('[chat-based-suggestion] .chat-based-suggestion');
  const button = (text: string) =>
    [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    )!;
  const html = () => host.editor.getHTML();
  const proposedText = () =>
    [...host.editor.view.dom.querySelectorAll('.aee-proposal')]
      .map((el) => el.textContent)
      .join('');
  const ask = async () => {
    host.editor.exec(host.editor.actions.find((a) => a.id === 'ai')!.command);
    await fixture.whenStable();
  };
  const settle = () => fixture.whenStable();

  beforeEach(async () => {
    asked = [];
    aborted = 0;
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: Ai, useValue: ai }],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => fixture.destroy());

  it('proposes the answer into the message itself, marked, with the bar up', async () => {
    expect(dialog()).toBeNull();
    await ask();
    expect(dialog()).not.toBeNull();
    expect(asked).toEqual([{ before: 'We met last week.', language: 'de', instructions: '' }]);
    await feed(' Bitte');
    await feed(' <strong>lesen');
    await feed(' Sie</strong> das.');
    // In the text, where it will stand — as a proposal.
    expect(html()).toBe(
      '<div>We met last week. Bitte <strong style="font-weight: bold;">lesen Sie</strong> das.</div>',
    );
    expect(isProposing(host.editor.state)).toBe(true);
    expect(proposedText()).toBe(' Bitte lesen Sie das.');
    // Not yet: the assistant is still writing. Discard is always there.
    expect(button('Apply').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(false);
    await feed(null);
    expect(button('Apply').disabled).toBe(false);
    // The chat input has the focus: the writer can steer at once.
    expect(document.activeElement?.classList.contains('email-chat-input__editor')).toBe(true);
  });

  it('Apply keeps the proposal as the message’s own — one change, one undo', async () => {
    await ask();
    await feed(' Bitte');
    await feed(' lesen.');
    await feed(null);
    button('Apply').click();
    await settle();
    expect(dialog()).toBeNull();
    expect(isProposing(host.editor.state)).toBe(false);
    expect(html()).toBe('<div>We met last week. Bitte lesen.</div>');
    expect(document.activeElement).toBe(host.editor.view.dom);
    expect(host.editor.exec(undo)).toBe(true);
    expect(html()).toBe(ORIGINAL);
  });

  it('a press outside is not leaving: the bar stays, the proposal too', async () => {
    await ask();
    await feed(' Bitte');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(dialog()).not.toBeNull();
    expect(aborted).toBe(0);
    expect(html()).toContain('Bitte');
  });

  it('the proposal is edited in place, and Apply takes it as it stands', async () => {
    await ask();
    await feed(' Bitte lesen.');
    await feed(null);
    // The writer's own edit, inside the proposal: it is proposed with it.
    const at = host.editor.getHTML().indexOf('lesen') - 4; // the doc position of "lesen"
    const pos = host.editor.state.doc.textContent.indexOf('lesen') + 1;
    host.editor.view.dispatch(host.editor.state.tr.insertText('bitte ', pos));
    await settle();
    expect(proposedText()).toBe(' Bitte bitte lesen.');
    expect(at).toBeGreaterThan(0);
    button('Apply').click();
    await settle();
    expect(html()).toBe('<div>We met last week. Bitte bitte lesen.</div>');
    expect(isProposing(host.editor.state)).toBe(false);
    expect(host.editor.exec(undo)).toBe(true);
    expect(html()).toBe(ORIGINAL);
  });

  it('Discard and Escape — from anywhere — do the same, and hand the caret back', async () => {
    await ask();
    await feed(' Bitte');
    button('Discard').click();
    await settle();
    expect(dialog()).toBeNull();
    expect(html()).toBe(ORIGINAL);
    expect(document.activeElement).toBe(host.editor.view.dom);

    await ask();
    await feed(' Bitte');
    // Escape in the text, where the writer was editing the proposal.
    host.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(dialog()).toBeNull();
    expect(html()).toBe(ORIGINAL);
    expect(aborted).toBe(2);
    expect(undo(host.editor.state)).toBe(false);
  });

  it('the chat input’s Enter asks again with the instructions, over the earlier proposal', async () => {
    await ask();
    await feed(' Bitte');
    await feed(null);
    // Typed into the chat input (a list item), then sent with Enter — the
    // chat's own; Ctrl-Enter is Apply while a proposal stands.
    const chat = (host.panel() as any).chat().editor();
    chat.commands['toggleBulletList']();
    chat.view.dispatch(chat.state.tr.insertText('kurz'));
    await settle();
    const input = dialog()!.querySelector<HTMLElement>('.email-chat-input__editor')!;
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    // Ctrl-Enter applied instead: the proposal is the message's now.
    expect(asked).toHaveLength(1);
    expect(dialog()).toBeNull();
    expect(html()).toBe('<div>We met last week. Bitte</div>');
    expect(isProposing(host.editor.state)).toBe(false);
  });

  it('one message at a time: Ctrl-Enter is swallowed and Enter refused while it writes; Stop ends it', async () => {
    await ask();
    await feed(' Bitte');
    const input = dialog()!.querySelector<HTMLElement>('.email-chat-input__editor')!;
    const chat = (host.panel() as any).chat().editor();
    chat.view.dispatch(chat.state.tr.insertText('kurz'));
    await settle();
    // The send button is a stop button now.
    expect(dialog()!.querySelector('[aria-label="Send"]')).toBeNull();
    const stop = dialog()!.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!;
    expect(stop).not.toBeNull();
    // Enter: refused, nothing asked; Ctrl-Enter: swallowed, nothing applied.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(asked).toHaveLength(1);
    expect(isProposing(host.editor.state)).toBe(true);
    expect(dialog()).not.toBeNull();
    // Stop: the writing ends where it is, and stays proposed.
    stop.click();
    await settle();
    expect(aborted).toBe(1);
    expect(proposedText()).toBe(' Bitte');
    expect(dialog()!.querySelector('[aria-label="Send"]')).not.toBeNull();
    // The instructions are still there: sent now, they ask over the whole.
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(asked[1]?.instructions).toBe('kurz');
  });

  it('with a part of the proposal selected, the ask writes that part again, the rest standing', async () => {
    await ask();
    await feed(' Bitte lesen. Danke.');
    await feed(null);
    // "lesen" selected in the text.
    const text = host.editor.state.doc.textContent;
    const from = text.indexOf('lesen') + 1;
    host.editor.view.dispatch(
      host.editor.state.tr.setSelection(
        TextSelection.create(host.editor.state.doc, from, from + 5),
      ),
    );
    await settle();
    const chat = (host.panel() as any).chat().editor();
    chat.view.dispatch(chat.state.tr.insertText('lauter'));
    await settle();
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
    await settle();
    expect(asked[1]).toEqual({
      before: 'We met last week.',
      language: 'de',
      instructions: 'lauter',
      selection: 'lesen',
    });
    // The part goes with the first piece that takes its place; the rest
    // stands throughout.
    expect(html()).toBe('<div>We met last week. Bitte lesen. Danke.</div>');
    await feed('LESEN');
    await feed(null);
    expect(html()).toBe('<div>We met last week. Bitte LESEN. Danke.</div>');
    expect(proposedText()).toBe(' Bitte LESEN. Danke.');
    button('Apply').click();
    await settle();
    expect(host.editor.exec(undo)).toBe(true);
    expect(html()).toBe(ORIGINAL);
  });

  it('the send button asks with what is typed, and shows the model thinking until the first word', async () => {
    await ask();
    await feed(' Bitte');
    await feed(null);
    const send = () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    const thinking = () => dialog()!.querySelector('[role="status"]');
    // Nothing typed: the one button is the voice input's place, not send.
    expect(send()).toBeNull();
    expect(dialog()!.querySelector('[aria-label^="Voice input"]')).not.toBeNull();
    const chat = (host.panel() as any).chat().editor();
    chat.view.dispatch(chat.state.tr.insertText('kurz'));
    await settle();
    expect(send()).not.toBeNull();
    send().click();
    await settle();
    expect(asked[1]?.instructions).toBe('kurz');
    // Asked, nothing come yet: thinking. The field is cleared for the next ask.
    expect(thinking()).not.toBeNull();
    expect(chat.state.doc.textContent).toBe('');
    // Sent: the field is empty again, and the button is the stop button
    // while the assistant writes, then the voice input's place.
    expect(dialog()!.querySelector('[aria-label="Stop"]')).not.toBeNull();
    await feed(' Kurz.');
    expect(thinking()).toBeNull();
    await feed(null);
    expect(html()).toBe('<div>We met last week. Kurz.</div>');
  });

  it('Escape closes a menu up over the text first, and lets the proposal go on the next', async () => {
    await ask();
    await feed(' Bitte lesen.');
    await feed(null);
    const popover = fixture.debugElement
      .query(By.directive(ChatBasedSuggestion))
      .injector.get(Popover);
    const closed = vi.fn(() => true);
    vi.spyOn(popover, 'close').mockImplementation(closed);
    const escape = () =>
      host.editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    escape();
    await settle();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect(html()).toContain('Bitte lesen.');
    closed.mockReturnValue(false);
    escape();
    await settle();
    expect(dialog()).toBeNull();
    expect(html()).toBe(ORIGINAL);
  });
});
