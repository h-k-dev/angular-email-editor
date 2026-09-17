import { TextSelection } from 'prosemirror-state';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,

  // Signals
  computed,
  effect,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

// CDK
import { Portal, PortalModule } from '@angular/cdk/portal';

import { AngularFileDrop, FileDropEvent } from '@h-k-dev/angular-file-drop';
import type { FormValueControl } from '@angular/forms/signals';

import { DropHint, DropHintArt } from '../drop-hint/drop-hint';
import { isTyping, releaseEditingSurface } from '../is-typing';
import { BlockMenu } from './block-menu/block-menu';
import { BubbleMenu } from './bubble-menu/bubble-menu';
import { FormattingCommands } from './formatting-commands';
import { FormattingToolbar } from './formatting-toolbar/formatting-toolbar';
import { LinkEditor } from './link-editor/link-editor';
import { Templates } from '../../../services/templates';
import { MergeTags } from '../../../services/merge-tags';
import { mergeTagSource } from './merge-tag-source';
import { templateGroup } from './template-group';

// Library
import {
  BlockMenuState,
  BubbleMenuState,
  Editor,
  SendIntent,
  SuggestionMenu,
  SuggestionMenuItem,
  SuggestionMenuState,
  TextMetrics,
  caretInsideMergeTag,
  createBlockMenu,
  createBubbleMenu,
  createEditor,
  createAngularExpressions,
  createImageDrag,
  createInlineImages,
  createSendIntent,
  createSuggestionMenu,
  extensionSuggestions,
  createTextMetrics,
  ExpressionDiagnostic,
  InlineImages,
  mergeTagAt,
  emailExtensions,
} from 'angular-email-editor';

/** Where the HTML source shows: nowhere, in the editing surface's place
    (code view), or beside the editor in its own column (detached). */
export type SourceView = 'hidden' | 'code' | 'detached';

/**
 * The composer: the editing surface with the editor mounted on it, and the
 * chrome that formats what is in it — the toolbar below, the bubble and
 * block menus and the link editor floating over the text, the suggestion
 * menu (`/`, `{{`) under the caret. One `FormattingCommands` binds them all
 * to this editor.
 */
@Component({
  selector: 'section[email-compose]',
  imports: [
    // Material
    MatIconModule,

    // CDK
    PortalModule,

    AngularFileDrop,
    BlockMenu,
    BubbleMenu,
    DropHint,
    FormattingToolbar,
    LinkEditor,
    SuggestionMenu,
    SuggestionMenuItem,
  ],
  // The formatting commands this composer's toolbar, bubble menu and ⋯ menu
  // share — one per composer, bound to its editor and code view.
  providers: [FormattingCommands],
  templateUrl: './email-compose.html',
  styleUrl: './email-compose.scss',
})
export class EmailCompose implements FormValueControl<string> {
  #destroyRef = inject(DestroyRef);
  readonly #commands = inject(FormattingCommands);
  /** The composer's inline image registry — provided by the composer. */
  readonly #images = inject(InlineImages);
  /** The template store the slash menu's /templates group searches. */
  readonly #templates = inject(Templates);
  /** The variable catalogue the `{{` menu searches. */
  readonly #mergeTags = inject(MergeTags);

  /** Canonical email HTML — the form's `html` field, bound with
      `[formField]` (this pane is a `FormValueControl<string>`), or two-way
      as `[(value)]`. This editor owns the canonical form: whatever comes in
      is parsed through the email schema and re-published as what survived. */
  value = model('');

  /** Focus left the editor — the form marks the body field touched on it. */
  touch = output<void>();

  /** How the HTML source shows. Driven from outside — the composer's writer
      bar holds the toggles (in this surface's place, or beside it), and
      revealing a lint finding lands in the source — and two-way, because
      this pane leaves code view by itself when the form asks it for focus.
      The composer owns the pane; this component only knows the slot it can
      offer (see `codePortal`). */
  sourceView = model<SourceView>('hidden');

  /** Code view (Summernote's </>): the source stands in the editing surface's
      place and the toolbar targets it. */
  codeView = computed(() => this.sourceView() === 'code');

  /** The source pane as a DOM portal, attached into the code-view slot while
      `sourceView` is 'code' — the composer builds it, since it owns the
      pane; null otherwise, and the pane returns to its own column. */
  codePortal = input<Portal<unknown> | null>(null);

  /** The source pane's editor. Its kit mirrors every mark command and
      history, so in code view the toolbar's mark buttons act on *it* — the
      same command, on the visible text. */
  codeEditor = input<Editor | undefined>();

  /** Whether the formatting toolbar shows. The host's to switch (the
      writer bar's formatting button); hidden, the text keeps its keyboard
      shortcuts, the slash menu and the bubble menu. */
  toolbar = input(true);

  /** Files let go over the editing surface that the editor did not take for
      itself — attachments, by the host's reading. The surface is the
      dropzone, and only the surface: the paper, where a file goes *into*
      the message; the toolbar and the strip below the body are chrome, and
      a drop there falls through to whatever wraps the composer. This
      component only carries the drop out. What the editor keeps is decided
      inside it (`claimedImageFiles`): a drag of nothing but images embeds
      inline, so it never lights the surface and its drop never arrives
      here. Everything else does, whole. */
  fileDrop = output<FileDropEvent>();

  /** An image-only drag over the text: the editor's, to embed — the one
      drag the surface's dropzone never reports, since the editor claims it
      as it comes over (`claimDragEvent` on its drag events) and the zone
      stands down. Told by the editor itself, through `createImageDrag`. */
  protected readonly imageDrag = signal(false);

  /** What the surface's hint says: the two outcomes of a drop on the text,
      named at the moment of the drop. Images alone go *into* the message;
      anything else — a PDF, or an image among other files — is attached,
      as it would be anywhere else on the message. */
  protected readonly surfaceHint = computed<{ art: DropHintArt; heading: string; text: string }>(
    () =>
      this.imageDrag()
        ? {
            art: 'inline',
            heading: 'Drop to place in the text',
            text: 'The image lands where the caret is, in the message itself. To attach it instead, drop it outside the text — on the address rows or the toolbar.',
          }
        : {
            art: 'attach',
            heading: 'Drop to attach',
            text: 'The files join the attachments below the message. An image dropped here on its own is placed in the text instead.',
          },
  );

  readonly #injector = inject(Injector);
  /** The send *intent*: canonical HTML + text/plain projection, emitted when
      the user asks to send (/send, Mod-Enter, or {@link requestSend} from the
      writer's Send button). Envelope and transport are the host's — this is
      the whole send API. */
  send = output<SendIntent>();

  #capturing = false;
  #captured: SendIntent | undefined;

  /** The send payload, built now and handed back — for the host's submit
      action. Always the email editor: its send-intent extension builds it,
      and in code view its document is already the source's (it syncs while
      unfocused). Nothing is emitted; `send` is for the user's own gestures.
      Undefined before the editor has mounted. */
  intent(): SendIntent | undefined {
    const editor = this.editor();
    if (!editor) return undefined;
    this.#capturing = true;
    this.#captured = undefined;
    try {
      editor.commands['requestSend']();
      return this.#captured;
    } finally {
      this.#capturing = false;
    }
  }

  editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  /** The suggestion menu's box, handed to its extension — one for every
      trigger: they never open together. */
  suggestionMenu = viewChild.required<SuggestionMenu, ElementRef<HTMLElement>>('suggestionMenu', {
    read: ElementRef,
  });
  /** The floating menus and the link editor: the extensions place the
      first two through their state, the link items open the third. */
  protected readonly blockMenu = viewChild.required(BlockMenu);
  protected readonly linkEditor = viewChild.required(LinkEditor);

  /** The email editor, once mounted — the formatting commands' own. */
  readonly editor = this.#commands.editor;
  /** The suggestion menu's live state — of whichever trigger is open: `/`
      (the kit's commands and the Templates group) or `{{` (the variable
      catalogue, a page at a time). */
  suggestionState = signal<SuggestionMenuState | undefined>(undefined);

  /** The bubble menu's state, from its extension: open on a selection. */
  protected readonly bubbleMenuState = signal<BubbleMenuState>({
    isOpen: false,
    boundingBox: null,
  });

  /** The block menu's state, from its extension: open on a bare cursor in
      a layout block — never together with the bubble menu. */
  protected readonly blockMenuState = signal<BlockMenuState>({
    isOpen: false,
    boundingBox: null,
    block: null,
  });

  /** Body stats measured mathematically via pretext — no DOM reads. */
  bodyMetrics = signal<TextMetrics | undefined>(undefined);

  /** Syntax problems in the body's AngularJS expressions (the dialect this
      composer opts into) — counted in the status strip beside the source
      pane's lint, revealed in this pane. */
  expressionDiagnostics = signal<ExpressionDiagnostic[]>([]);

  /** Selects the token range of a diagnostic and focuses the editor. */
  revealExpression(diagnostic: ExpressionDiagnostic): void {
    const editor = this.editor();
    if (!editor) return;
    const { doc } = editor.state;
    // An end-of-input problem has no width: select the whole token instead.
    const token = diagnostic.from === diagnostic.to ? mergeTagAt(doc, diagnostic.from) : undefined;
    const from = token?.from ?? diagnostic.from;
    const to = token?.to ?? Math.min(Math.max(diagnostic.to, from + 1), doc.content.size);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, from, to)).scrollIntoView(),
    );
    editor.view.focus();
  }

  constructor() {
    // No phase: mounting ProseMirror writes the DOM and reads it back (the
    // selection, the caret's coordinates) in one go.
    afterNextRender(() => this.#mountEditor());

    this.#commands.connect({
      codeView: this.codeView,
      codeEditor: this.codeEditor,
      html: this.value,
      openLink: () => this.linkEditor().show(),
    });

    this.#destroyRef.onDestroy(() => this.editor()?.destroy());

    // Incoming html (the source pane's edits, a draft from another tab)
    // parses through the email schema. Skipped while this editor has focus:
    // then it is the origin of the signal value, not a consumer. `setContent`
    // dispatches no transaction, so applying can't echo through `onUpdate`.
    effect(() => {
      this.value(); // track: any external write re-runs this
      const editor = this.editor();
      if (!editor || isTyping(editor.view)) return;
      this.#applyIncoming(editor);
    });
  }

  /** Applies the signal's current value to the editor and re-publishes the
      canonical form (what survived the schema round-trip). */
  #applyIncoming(editor: Editor): void {
    const incoming = this.value();
    if (incoming === editor.getHTML()) return;
    editor.setContent(incoming);
    this.value.set(editor.getHTML());
  }

  #mountEditor(): void {
    const editor = createEditor({
      parent: this.editorHost().nativeElement,
      extensions: [
        ...emailExtensions,
        createBubbleMenu({
          updateDelay: 150,
          onStateChange: (state) => this.bubbleMenuState.set(state),
        }),
        createBlockMenu({
          onStateChange: (state) => this.blockMenuState.set(state),
          menuElement: () => this.blockMenu().element()?.nativeElement,
        }),
        // One suggestion menu, a trigger per list: `/` for the kit's commands
        // and the Templates group, `{{` for the variable catalogue — and any
        // further one (`@`, `||`) is another entry here, nothing else. Both
        // sources are server-backed and keep the default 300ms debounce;
        // where their sessions overlap, the trigger nearest the caret opens.
        createSuggestionMenu({
          element: this.suggestionMenu().nativeElement,
          onChange: (state) => this.suggestionState.set(state),
          triggers: [
            {
              trigger: '/',
              label: 'Insert block',
              placeholder: 'Type to filter…',
              items: (ctx) => [...extensionSuggestions(ctx), templateGroup(this.#templates)],
            },
            {
              trigger: '{{',
              label: 'Personalization tokens',
              placeholder: 'Search tokens…',
              // Right after any character, and only a path: one optional
              // space, then letters, digits, `_` and `.`.
              startOfWord: false,
              query: /^ ?[\w.]*$/,
              // Not for a caret inside a token already written: those
              // braces are the token's, and a pick would land inside it.
              allow: ({ state }) => !caretInsideMergeTag(state),
              source: mergeTagSource(this.#mergeTags),
            },
          ],
        }),
        // The dialect is the sponsor's: AngularJS expressions. Opt-in — a
        // Handlebars host installs its own dialect here instead.
        createAngularExpressions({ onDiagnostics: (d) => this.expressionDiagnostics.set(d) }),
        createTextMetrics({ onMetrics: (metrics) => this.bodyMetrics.set(metrics) }),
        createInlineImages({ registry: this.#images }),
        createImageDrag({ onChange: (over) => this.imageDrag.set(over) }),
        // A user's gesture (Mod-Enter, /send) goes out as the send output; a
        // host asking for the payload (`intent()`) gets it handed back instead.
        createSendIntent({
          onSend: (intent) => {
            if (this.#capturing) this.#captured = intent;
            else this.send.emit(intent);
          },
        }),
        this.#commands.sync,
      ],
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message body' },
      onUpdate: (editor) => this.value.set(editor.getHTML()),
    });
    // External writes must survive focus: the sync effect skips while this
    // editor is focused — so on blur, catch up with whatever the signal says
    // *now*. Last writer wins: if our own typing published after the external
    // write, the values already agree and this is a no-op. Without this, an
    // async draft restore or import landing mid-edit would be dropped forever.
    editor.view.dom.addEventListener('blur', () => {
      this.#applyIncoming(editor);
      this.touch.emit();
    });
    // …and on the way back in: a window switch keeps the editor the active
    // element, so a write that landed while the tab was in the background
    // (`isTyping` let it through, but a blur can have come first) is taken
    // before the first keystroke rather than typed over.
    editor.view.dom.addEventListener('focus', () => this.#applyIncoming(editor));
    this.#commands.mount(editor);
    // Whatever the value already is — a restored draft is there before the
    // editor is — goes in first; only then does the editor publish its
    // canonical form. Publishing the empty document it mounted with would
    // write over the value it was given.
    this.#applyIncoming(editor);
    this.value.set(editor.getHTML());
    // No focus of its own: where the caret starts is the page's decision
    // (the composer puts it in To), and the form's way in is `focus()`.
    // Mounting runs in the mixed render phase, after the page's focus write
    // — taking focus here would take it back.
  }

  focusEditor(): void {
    this.#commands.focus();
  }

  /** The form's way in (`focusBoundControl` on the body field): the caret
      goes to the email editor — leaving code view first if the source is
      standing in its place, since a hidden editor cannot take focus. */
  focus(): void {
    if (!this.codeView()) {
      this.editor()?.focus();
      return;
    }
    releaseEditingSurface();
    this.sourceView.set('hidden');
    afterNextRender({ write: () => this.editor()?.focus() }, { injector: this.#injector });
  }
}
