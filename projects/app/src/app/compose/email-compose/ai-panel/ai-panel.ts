import {
  Component,
  ElementRef,
  TemplateRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// ProseMirror
import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import {
  Node as ProseMirrorNode,
  DOMParser as ProseMirrorDOMParser,
  Slice,
} from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Library
import {
  BaseKeymap,
  BulletList,
  ContentStreamReveal,
  ContentStreamRun,
  Document,
  Editor,
  Extension,
  HardBreak,
  History,
  ListItem,
  NoTextDrag,
  OrderedList,
  Paragraph,
  Text,
  createContentStream,
  createEditor,
  defineExtension,
  emailExtensions,
  streamContent,
} from 'angular-email-editor';
import { AnchorRect } from 'angular-email-editor/anchor';

import { Ai } from '../../../../services/ai';
import { I18n } from '../../../../services/i18n';
import { FormattingCommands } from '../formatting-commands';
import { dismissOnPressOutside } from '../../dismiss-outside';
import { Popover } from '../popover/popover';
import { AiAsk } from '../ai-writer';

/** Under the caret, opening to the right of it — the way the `/` menu
    stands, since that is where the panel comes from; above when there is
    no room below. Not centred: at a line's start a centred panel would
    hang off the sheet. */
const UNDER_THE_CARET: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
];

/** Says what the field is for while it is empty — a widget on the empty
    paragraph, styled by the panel's stylesheet; the library paints nothing. */
const placeholder = (text: () => string): Extension =>
  defineExtension({
    name: 'placeholder',
    plugins: () => [
      new Plugin({
        key: new PluginKey('placeholder'),
        props: {
          decorations: (state) => {
            const { doc } = state;
            const empty =
              doc.childCount === 1 &&
              doc.firstChild!.isTextblock &&
              doc.firstChild!.content.size === 0;
            if (!empty) return null;
            return DecorationSet.create(doc, [
              Decoration.node(0, doc.firstChild!.nodeSize, {
                class: 'ai-panel__empty',
                'data-placeholder': text(),
              }),
            ]);
          },
        },
      }),
    ],
  });

/** The prompt as the assistant reads it: a line per block, a list item as
    a dash line — the writer's points, kept as points. */
function promptText(doc: ProseMirrorNode): string {
  const lines: string[] = [];
  doc.descendants((node, _pos, parent) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, '\n', ' ').trim();
    if (text) lines.push(parent?.type.name === 'listItem' ? `- ${text}` : text);
    return false;
  });
  return lines.join('\n');
}

/** The proposal as an *open* slice, the way typed text joins the line it
    is written into: a way on continues the sentence, a whole email's first
    line takes the empty line the caret is on. */
function proposalSlice(html: string, state: EditorState): Slice {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  return ProseMirrorDOMParser.fromSchema(state.schema).parseSlice(dom.body);
}

/**
 * The assistant's panel: what the assistant writes, on a layer of its own
 * over the text — a panel of the composer's one popover, under the caret.
 * Opened by the `ai` action (`createAiWriter`) with what stands before the
 * caret; the answer streams into a **preview** here, not into the message.
 * Under it, a **prompt** — an editor of its own, plain lines and lists, so
 * the writer's points stay points — steers it: Rewrite (Ctrl-Enter) asks
 * again with the instructions, cutting short whatever was still coming.
 * **Accept** takes the preview into the message at the caret, as one
 * change — one undo. Anything else — Escape, a press outside — lets it go:
 * the panel closes, the stream stops, and the message is exactly as it
 * was, with nothing in its history. Nothing the assistant wrote touches
 * the document until it is accepted.
 *
 * The preview is the email kit with the library's content stream, read
 * only, so the answer forms the way it would in the message — a list
 * takes shape, a bold phrase arrives bold — with the same caret and fade,
 * and Accept inserts the very HTML the preview holds. Both editors live
 * only while the panel is up: they are made as its content renders and
 * destroyed as it goes.
 */
@Component({
  selector: 'div[ai-panel]',
  imports: [
    // Material
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './ai-panel.html',
  styleUrl: './ai-panel.scss',
})
export class AiPanel {
  readonly #commands = inject(FormattingCommands);

  readonly #popover = inject(Popover);

  readonly #ai = inject(Ai);

  protected readonly i18n = inject(I18n);

  /** The language the assistant writes in — the composer's, asked when the
      writing starts. */
  readonly language = input<() => 'en' | 'de' | 'ja'>(() => 'en');

  /** How the preview reveals what comes in — the library's `'block'` by
      default; a spec asks for `'instant'`. */
  readonly reveal = input<ContentStreamReveal>('block');

  protected readonly open = signal(false);

  protected readonly anchor = signal<AnchorRect | null>(null);

  /** The assistant is writing. */
  protected readonly streaming = signal(false);

  /** There is something to accept: the assistant has written, and it
      is not being written over. */
  protected readonly proposed = signal(false);

  protected readonly canAccept = computed(() => this.proposed() && !this.streaming());

  protected readonly previewHost = viewChild<ElementRef<HTMLElement>>('preview');

  protected readonly promptHost = viewChild<ElementRef<HTMLElement>>('prompt');

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  /** What the writer asked from, for as long as the panel is up. */
  #ask: AiAsk | null = null;

  /** The two editors, while the panel is up: the preview the answer
      streams into, and the prompt. */
  protected readonly editors = signal<{ preview: Editor; prompt: Editor } | null>(null);

  #run: ContentStreamRun | null = null;

  constructor() {
    this.#popover.register({
      layer: 'dialog',
      open: this.open,
      anchor: this.anchor,
      content: this.panel,
      positions: () => UNDER_THE_CARET,
      onKeydown: (event) => this.onKeydown(event),
    });
    // A press outside lets the proposal go — never the click (a `/` menu
    // row) that opened the panel.
    dismissOnPressOutside(
      this.open,
      () => this.#popover.pane(),
      () => this.dismiss(),
    );

    // The editors live with the panel's content: made once its hosts have
    // rendered (a DOM write, after the render), destroyed as they go.
    afterRenderEffect((onCleanup) => {
      const preview = this.previewHost()?.nativeElement;
      const prompt = this.promptHost()?.nativeElement;
      if (!preview || !prompt) return;
      const reveal = this.reveal();
      untracked(() => {
        this.#mount(preview, prompt, reveal);
        this.#write();
      });
      onCleanup(() => this.#unmount());
    });
  }

  /** Opens the panel under the caret and asks the assistant at once. */
  show(ask: AiAsk): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    this.anchor.set({ left: coords.left, top: coords.top, height: coords.bottom - coords.top });
    this.#ask = ask;
    this.proposed.set(false);
    // Up already (asked twice): the same editors, asked again.
    if (this.open()) this.#write();
    else this.open.set(true);
  }

  /** Takes the proposal into the message, at the caret, as one change. */
  protected accept(): void {
    const editor = this.#commands.editor();
    const preview = this.editors()?.preview;
    if (!editor || !preview || !this.canAccept()) return;
    const { state } = editor;
    const slice = proposalSlice(preview.getHTML(), state);
    const tr = state.tr;
    // A way on joins the sentence: the space the answer opened with, which
    // the preview's own line dropped, is put back before the words.
    const { $from } = state.selection;
    const before = $from.parent.isTextblock ? $from.parent.textBetween(0, $from.parentOffset) : '';
    const opensInline = slice.content.firstChild?.isTextblock && slice.openStart > 0;
    if (before && !/\s$/.test(before) && opensInline) tr.insertText(' ');
    tr.replaceSelection(slice).scrollIntoView();
    editor.view.dispatch(tr);
    this.#close();
    editor.focus();
  }

  /** Asks again, with the prompt's instructions — cutting short whatever
      was still coming. */
  protected rewrite(): void {
    this.#write();
  }

  /** Escape: lets it go, and the caret is back in the text. */
  protected close(): void {
    this.#close();
    this.#commands.focus();
  }

  /** A press outside lets it go — and is just a press. */
  protected dismiss(): void {
    this.#close();
  }

  /** Escape from anywhere in the panel — the prompt, a button — and from
      the editor beneath; an IME's own Escape stays the IME's. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    this.close();
  }

  #close(): void {
    this.#stop();
    this.open.set(false);
  }

  #stop(): void {
    this.#run?.stop();
    this.#run = null;
  }

  #mount(previewHost: HTMLElement, promptHost: HTMLElement, reveal: ContentStreamReveal): void {
    const preview = createEditor({
      parent: previewHost,
      extensions: [
        ...emailExtensions,
        createContentStream({
          reveal,
          onChange: (state) => this.streaming.set(state.streaming),
        }),
      ],
      attributes: {
        class: 'ai-panel__preview-editor',
        'aria-label': this.i18n.t('editor.ai.preview', 'Suggested text'),
      },
    });
    // Read only: the proposal is the assistant's until it is accepted.
    preview.view.setProps({ editable: () => false });

    const submit: Command = (_state, dispatch) => {
      if (dispatch) this.rewrite();
      return true;
    };
    const prompt = createEditor({
      parent: promptHost,
      extensions: [
        Document,
        Paragraph,
        Text,
        HardBreak,
        // Lists, and nothing else: the writer's points, as points. A
        // heading or a bold word says nothing to an assistant.
        BulletList,
        OrderedList,
        ListItem,
        History,
        NoTextDrag,
        defineExtension({ name: 'aiPromptKeys', keymap: () => ({ 'Mod-Enter': submit }) }),
        BaseKeymap,
        placeholder(() => this.i18n.t('editor.ai.prompt', 'Tell the assistant what to change…')),
      ],
      attributes: {
        class: 'ai-panel__prompt-editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': this.i18n.t('editor.ai.instructions', 'Instructions'),
      },
    });
    this.editors.set({ preview, prompt });
    prompt.focus();
  }

  #unmount(): void {
    this.#stop();
    const editors = this.editors();
    editors?.preview.destroy();
    editors?.prompt.destroy();
    this.editors.set(null);
    this.streaming.set(false);
  }

  /** Asks the assistant and streams the answer into the preview, from a
      clean slate. */
  #write(): void {
    const editors = this.editors();
    const ask = this.#ask;
    if (!editors || !ask) return;
    this.#stop();
    const { preview, prompt } = editors;
    preview.setContent('');
    this.proposed.set(false);
    const request = {
      before: ask.before,
      language: this.language()(),
      instructions: promptText(prompt.state.doc),
    };
    // Into the preview's one empty line, the way the message's own empty
    // line would take it.
    const run = streamContent(
      preview.view,
      1,
      async ({ write, signal }) => {
        for await (const piece of this.#ai.write(request, { signal })) write(piece);
      },
      { format: 'html' },
    );
    this.#run = run;
    run.done
      .then((finished) => {
        if (this.#run !== run) return;
        this.#run = null;
        // Stopped short, what shows is still the assistant's — accept it
        // or ask again.
        this.proposed.set(preview.state.doc.textContent.trim() !== '' || !finished);
      })
      .catch((reason) => console.error(reason));
  }
}
