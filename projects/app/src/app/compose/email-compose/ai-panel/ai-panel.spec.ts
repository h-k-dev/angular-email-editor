import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { Popover } from '../popover/popover';
import { PopoverOutlet } from '../popover/popover-outlet';
import { createAiWriter } from '../ai-writer';
import { AiPanel } from './ai-panel';

// jsdom lacks what the editor needs at mount (see compose.spec.ts).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** A composer's worth: the commands, the popover, the panel, and an email
    editor with the `ai` action, the stream and the proposal in its kit. */
@Component({
  imports: [AiPanel, PopoverOutlet],
  providers: [FormattingCommands, Popover],
  template: `
    <div #host></div>
    <div ai-panel [language]="language"></div>
    <div popover-outlet></div>
  `,
})
class Host {
  readonly language = () => 'de' as const;
  readonly commands = inject(FormattingCommands);
  readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  readonly panel = viewChild.required(AiPanel);
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
      // jsdom has no layout: the panel's anchor needs a box to stand on.
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

describe('AiPanel', () => {
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
  const dialog = () => document.querySelector<HTMLElement>('.popover [role="dialog"]');
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

  it('proposes the answer into the message itself, marked, and floats under it', async () => {
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

  it('a press outside takes it out: the message is as it was, with nothing to undo', async () => {
    await ask();
    await feed(' Bitte');
    expect(html()).toContain('Bitte');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(dialog()).toBeNull();
    expect(aborted).toBe(1);
    expect(html()).toBe(ORIGINAL);
    expect(undo(host.editor.state)).toBe(false);
  });

  it('Discard and Escape do the same, and hand the caret back', async () => {
    await ask();
    await feed(' Bitte');
    button('Discard').click();
    await settle();
    expect(dialog()).toBeNull();
    expect(html()).toBe(ORIGINAL);
    expect(document.activeElement).toBe(host.editor.view.dom);

    await ask();
    await feed(' Bitte');
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(dialog()).toBeNull();
    expect(html()).toBe(ORIGINAL);
    expect(aborted).toBe(2);
  });

  it('the chat input’s Enter asks again with the instructions, over the earlier proposal', async () => {
    await ask();
    await feed(' Bitte');
    // Typed into the chat input (a list item), then sent with Ctrl-Enter.
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
    expect(aborted).toBe(1);
    expect(asked[1]).toEqual({
      before: 'We met last week.',
      language: 'de',
      instructions: '- kurz',
    });
    // The first proposal went with the ask; the new one takes its place.
    expect(html()).toBe(ORIGINAL);
    await feed(' Kurz.');
    await feed(null);
    expect(html()).toBe('<div>We met last week. Kurz.</div>');
    expect(proposedText()).toBe(' Kurz.');
  });

  it('Try again asks once more with the same instructions', async () => {
    await ask();
    await feed(' Bitte');
    await feed(null);
    button('Try again').click();
    await settle();
    expect(asked).toHaveLength(2);
    expect(html()).toBe(ORIGINAL);
  });
});
