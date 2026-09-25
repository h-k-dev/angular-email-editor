import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';

import { Editor, createEditor, emailExtensions } from 'angular-email-editor';

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
    editor with the `ai` action in its kit. */
@Component({
  imports: [AiPanel, PopoverOutlet],
  providers: [FormattingCommands, Popover],
  template: `
    <div #host></div>
    <div ai-panel reveal="instant" [language]="language"></div>
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
  const preview = () => dialog()?.querySelector('.ai-panel__preview')?.textContent?.trim() ?? null;
  const button = (label: string) =>
    dialog()!.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
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

  it('opens under the caret and streams the answer into its preview — never into the message', async () => {
    expect(dialog()).toBeNull();
    await ask();
    expect(dialog()).not.toBeNull();
    expect(asked).toEqual([{ before: 'We met last week.', language: 'de', instructions: '' }]);
    await feed(' Bitte');
    await feed(' <strong>lesen');
    await feed(' Sie</strong> das.');
    expect(preview()).toBe('Bitte lesen Sie das.');
    expect(host.editor.getHTML()).toBe(ORIGINAL);
    // Not yet: the assistant is still writing.
    expect(button('Accept and insert').disabled).toBe(true);
    await feed(null);
    expect(button('Accept and insert').disabled).toBe(false);
    // The prompt has the focus: the writer can steer at once.
    expect(document.activeElement?.classList.contains('ai-panel__prompt-editor')).toBe(true);
  });

  it('Accept takes the proposal into the message at the caret, as one change', async () => {
    await ask();
    await feed(' Bitte');
    await feed(' <strong>lesen Sie</strong> das.');
    await feed(null);
    button('Accept and insert').click();
    await settle();
    expect(dialog()).toBeNull();
    expect(host.editor.getHTML()).toBe(
      '<div>We met last week. Bitte <strong style="font-weight: bold;">lesen Sie</strong> das.</div>',
    );
    expect(document.activeElement).toBe(host.editor.view.dom);
    // One undo, and the message is as it was.
    expect(host.editor.exec(undo)).toBe(true);
    expect(host.editor.getHTML()).toBe(ORIGINAL);
  });

  it('a press outside lets it go: the stream stops, the message is as it was, with nothing to undo', async () => {
    await ask();
    await feed(' Bitte');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(dialog()).toBeNull();
    expect(aborted).toBe(1);
    expect(host.editor.getHTML()).toBe(ORIGINAL);
    expect(undo(host.editor.state)).toBe(false);
  });

  it('Escape lets it go too, and hands the caret back', async () => {
    await ask();
    await feed(' Bitte');
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(dialog()).toBeNull();
    expect(aborted).toBe(1);
    expect(host.editor.getHTML()).toBe(ORIGINAL);
    expect(document.activeElement).toBe(host.editor.view.dom);
  });

  it('Rewrite asks again with the prompt’s instructions — a list as points — and starts the preview over', async () => {
    await ask();
    await feed(' Bitte');
    const { prompt } = (host.panel() as any).editors();
    prompt.setContent('<p>Make it</p><ul><li>short</li><li>friendly</li></ul>');
    prompt.view.dom.dispatchEvent(
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
      instructions: 'Make it\n- short\n- friendly',
    });
    expect(preview()).toBe('');
    await feed(' Kurz.');
    await feed(null);
    expect(preview()).toBe('Kurz.');
    expect(host.editor.getHTML()).toBe(ORIGINAL);
  });

  it('a whole email on an empty line lands whole, its blocks as blocks', async () => {
    host.editor.setContent('<div><br></div>');
    host.editor.view.dispatch(
      host.editor.state.tr.setSelection(TextSelection.create(host.editor.state.doc, 1)),
    );
    await ask();
    await feed('<div>Hallo,</div><div><br></div><ul><li>eins</li>');
    await feed('<li>zwei</li></ul>');
    await feed(null);
    button('Accept and insert').click();
    await settle();
    // The canonical form of that email: what the editor makes of the same
    // HTML when given it whole.
    const whole = createEditor({
      parent: document.createElement('div'),
      extensions: emailExtensions,
      content: '<div>Hallo,</div><div><br></div><ul><li>eins</li><li>zwei</li></ul>',
    });
    expect(host.editor.getHTML()).toBe(whole.getHTML());
    expect(host.editor.getHTML()).toMatch(/^<div>Hallo,<\/div><div><br><\/div><ul/);
    whole.destroy();
  });
});
