import { TextSelection } from 'prosemirror-state';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  inject,

  // Signals
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { NgTemplateOutlet } from '@angular/common';

// Material
import { MatIconModule } from '@angular/material/icon';

// CDK
import { Portal, PortalModule } from '@angular/cdk/portal';

import { AngularFileDrop, FileDropEvent, claimDragEvent } from '@h-k-dev/angular-file-drop';
import type { FormValueControl } from '@angular/forms/signals';

import { DropHint, DropHintArt } from '../../../common/drop-hint/drop-hint';
import { releaseEditingSurface } from '../is-typing';
import { PaperIsland } from '../paper-island';
import { TableMenu } from './table-menu/table-menu';
import { CellMenu } from './cell-menu/cell-menu';
import { SectionMenu } from './section-menu/section-menu';
import { BubbleMenu } from './bubble-menu/bubble-menu';
import { FormattingCommands } from './formatting-commands';
import { FormattingToolbar } from './formatting-toolbar/formatting-toolbar';
import { HeightSwitch } from '../../../../../core/directives/height-switch/height-switch';
import { FloatingScrollbar } from '../../../common/floating-scrollbar/floating-scrollbar';
import { FloatingFoot, footClearance } from './floating-foot';
import { LinkEditor } from './link-editor/link-editor';
import { AltTextEditor } from './alt-text-editor/alt-text-editor';
import { ChatBasedSuggestion } from './chat-based-suggestion/chat-based-suggestion';
import { Popover } from './popover/popover';
import { PopoverOutlet } from './popover/popover-outlet';
import { Examples } from '../../../../../core/email/examples';
import { examplesGroup } from './examples-group';
import { MergeTags } from '../../../../../core/email/merge-tags';
import { I18n } from '../../../../../core/translations/i18n';
import { createAiWriter } from './ai-writer';
import { MERGE_TAG_SOURCE } from './merge-tag-source';
import { TEMPLATE_SOURCE, templateGroup } from './template-group';
import type { TemplateEnvelope } from '../../../../../core/email/templates';
import { SNIPPET_SOURCE, snippetGroup } from './snippet-group';
import { SNIPPET_ITEMS } from './formatting-items';

// Library
import {
  ColumnHandleTarget,
  SectionHandleTarget,
  TableHandleTarget,
  BubbleMenuState,
  Editor,
  SendIntent,
  SuggestionMenuState,
  beginBlockMarquee,
  createBlockMarquee,
  createTableHandles,
  createColumnHandles,
  createSectionHandles,
  createBubbleMenu,
  createDarkRendering,
  dawnDarkColor,
  createButtonEdit,
  createContentProposal,
  createContentStream,
  createAngularExpressions,
  createImageDrag,
  createInlineImages,
  createSendIntent,
  createMergeTagResolution,
  MergeTagResolutionReport,
  createSuggestionMenu,
  extensionSuggestions,
  ExpressionDiagnostic,
  InlineImages,
  mergeTagAt,
  mergeTagTrigger,
  emailExtensions,
  plainTextExtensions,
  snippetExtensions,
  Extension,
  ExtensionContext,
  SuggestionItem,
  createQuotedHistory,
  createPlaceholder,
  PlaceholderText,
  LAYOUT_INTERACTIVE,
  LayoutInteractivity,
} from '@h-k-dev/angular-email-editor';
import { EditorKit, EmailEditor } from '@h-k-dev/angular-email-editor/editor';
import {
  SuggestionMenu,
  SuggestionMenuItem,
  SuggestionMenuSection,
} from '@h-k-dev/angular-email-editor/suggestion-menu';
import {
  EMAIL_CUSTOM_SWATCHES,
  colorSuggestions,
  injectPalette,
} from '@h-k-dev/angular-email-editor/palette';
import { emailDefaultFont } from '@h-k-dev/angular-email-editor/fonts';
import { TextMetrics, createTextMetrics } from '@h-k-dev/angular-email-editor/metrics';
import { TranslatePipe } from '@ngx-translate/core';

import { ScrollOwner } from '../../../../../core/directives/scroll-owner/scroll-owner';

/** Where the HTML source shows: nowhere, in the editing surface's place
    (code view), or beside the editor in its own column (detached). */
export type SourceView = 'hidden' | 'code' | 'detached';

/** How the editing surface draws the message: on pure white, as it is sent,
    or the way a dark-mode client shows that same message (`colorScheme`). */
export type EditorColorScheme = 'light' | 'dark';

/** The editor root while its paper is dark (`colorScheme`) — where Dawn
    draws it dark. */
const DARK_PAPER = ".email-compose__editor[data-color-scheme='dark'] > .aee-editor";

/** What a message is written as: HTML (the email kit, formatting and all),
    or plain text — lines, sent as `text/plain` only (`plainTextExtensions`). */
export type BodyFormat = 'html' | 'text';

/** The kit the composer mounts: a message's format, or a snippet — a piece
    of formatted text kept to drop into messages (`snippetExtensions`):
    words, lists and tokens, nothing a message is laid out with. */
export type ComposeKit = BodyFormat | 'snippet';

/**
 * The composer: the editing surface with the editor mounted on it, and the
 * chrome that formats what is in it — the toolbar below, the bubble and
 * block menus, the grip's menu and the link and alt-text editors floating
 * over the text, the suggestion menu (`/`, `{{`) under the caret. One
 * `FormattingCommands` binds them all to this editor; one `Popover` is
 * what floats, and each menu only a panel of it.
 */
@Component({
  selector: 'section[email-compose]',
  imports: [
    TranslatePipe,
    NgTemplateOutlet,
    // Material
    MatIconModule,

    // CDK
    PortalModule,

    AngularFileDrop,
    EmailEditor,
    TableMenu,
    CellMenu,
    SectionMenu,
    BubbleMenu,
    DropHint,
    FormattingToolbar,
    LinkEditor,
    AltTextEditor,
    ChatBasedSuggestion,
    HeightSwitch,
    FloatingScrollbar,
    FloatingFoot,
    PopoverOutlet,
    SuggestionMenu,
    SuggestionMenuItem,
    SuggestionMenuSection,
  ],
  // The formatting commands this composer's toolbar, bubble menu and ⋯ menu
  // share — one per composer, bound to its editor and code view — and the
  // one popover its floating menus are panels of.
  providers: [FormattingCommands, Popover],
  // The surface is set in the email's default font, not the app's: what is
  // written looks as it will in the recipient's Gmail, and the toolbar's
  // font menu shows Sans Serif ticked rather than the app's Roboto.
  host: {
    '[style.--mat-sys-prose-mirror-font-family]': 'surfaceFont',
    // What the floating foot covers of the text, for the text to keep clear
    // (floating-foot.ts).
    '[style.--email-compose-foot-room.px]': 'foot().room()',
    '[attr.data-scroll]': 'scroll()',
    '(focus)': 'onHostFocus()',
  },
  templateUrl: './email-compose.html',
  styleUrl: './email-compose.scss',
})
export class EmailCompose implements FormValueControl<string> {
  protected readonly surfaceFont = emailDefaultFont.stack;
  #destroyRef = inject(DestroyRef);
  readonly #commands = inject(FormattingCommands);
  /** The composer's inline image registry — provided by the composer. */
  readonly #images = inject(InlineImages);
  /** The rows of the slash menu's /templates group — the template store,
      as `TEMPLATE_SOURCE` gives it. */
  readonly #templateSource = inject(TEMPLATE_SOURCE);
  /** The rows of the slash menu's /snippets group — the snippet store, as
      `SNIPPET_SOURCE` gives it: each drops its text in at the caret. */
  readonly #snippetSource = inject(SNIPPET_SOURCE);

  /** The example documents the slash menu's /examples group lists. */
  readonly #examples = inject(Examples);

  /** The palette in use — the pickers' swatches, and the slash menu's colour
      rows (`EMAIL_PALETTE`; the library's unless the app provides one). */
  readonly #palette = injectPalette();
  /** The user's custom swatches — offered as `/` colour rows too. */
  readonly #customSwatches = inject(EMAIL_CUSTOM_SWATCHES);
  /** The variable catalogue: the `{{` menu's rows as the surface provides
      them (`MERGE_TAG_SOURCE`), and the values Parse fills in. */
  readonly #mergeTagSource = inject(MERGE_TAG_SOURCE);
  readonly #mergeTags = inject(MergeTags);
  /** The island the composer sits on, if any (a compose window): the
      marquee draws its box across it. */
  readonly #island = inject(PaperIsland, { optional: true });
  /** The words of the language in use — the menu asks when it opens. */
  protected readonly i18n = inject(I18n);

  /** The language the assistant writes in — a function, asked when the
      writing starts, so a switch is heard with nothing re-created. */
  protected readonly language = (): 'en' | 'de' | 'ja' => this.i18n.lang();

  /** How many rows a list has, for a screen reader — a function the menu
      calls, so it is one instance and reads the language when called. */
  protected readonly resultsLabel = (count: number): string =>
    count === 1
      ? this.i18n.t('editor.menu.results.one')
      : this.i18n.t('editor.menu.results.other', { count });

  /** Canonical email HTML — the form's `html` field, bound with
      `[formField]` (this pane is a `FormValueControl<string>`), or two-way
      as `[(value)]`. Handed on to the editor (`[emailEditor]`), which
      owns the canonical form: whatever comes in is parsed through the email
      schema and re-published as what survived. */
  value = model('');

  /** The quoted history a reply or forward answers — kept beside `value`,
      never replaced with it (a template, an `.eml`, the source pane), and
      sent under it. The editor's trash and Edit change it; two-way. */
  quoted = model<string | null>(null);

  /** Focus left the editor — the form marks the body field touched on it. */
  touch = output<void>();

  /** What the message is written as: HTML on the email kit, or plain text
      on the plain-text kit. A schema is an editor's for life, so a switch
      mounts a new editor on the other kit, in the old one's place, with
      `value` as it then stands — the host converts it as it switches
      (`plainTextHTML(emailPlainText(html))` into plain text). */
  format = input<ComposeKit>('html');

  /** The kit the editor in place was mounted with. */
  #mountedFormat: ComposeKit | null = null;

  /** The editor on the surface (`[emailEditor]`): mounting, the value both
      ways, the canonical form. */
  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly body = viewChild.required(EmailEditor);

  /** The editor's kit, by format: another format is another editor (a
      schema is an editor's for life), mounted in this one's place a render
      later, with the value the host converted as it switched. A function,
      so the kit is made as the editor mounts — once the menus it hands
      elements to are on screen. */
  protected readonly kit = computed<EditorKit>(() => {
    const format = this.format();
    return () => this.#kitFor(format);
  });

  /** The editable root's attributes. */
  protected readonly editorOptions = {
    attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message body' },
  };

  /** The body as the editor first published it — its canonical form — once
      mounted; null before. "Unsaved" is `value() !== baseline()`. */
  readonly baseline = computed(() => this.body().baseline());

  /** Puts `html` in the body even while it is being typed in, as one undo
      step — a Revert — and publishes what the editor made of it. */
  replace(html: string): void {
    this.body().replace(html);
  }

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

  /** Who scrolls the text: the surface itself (`own`), or the view round
      the composer (`host`) — wherever an ancestor owns the scroll
      (`ScrollOwner`: the phone's sheet, a document's, the designer's
      canvas), so what is above the text scrolls away with it. Handed over,
      the composer grows with its text, its floating foot sticks to the
      owner's bottom, and the owner keeps the foot's room clear at its end. */
  readonly #scrollOwner = inject(ScrollOwner, { optional: true });
  readonly scroll = computed<'own' | 'host'>(() => (this.#scrollOwner?.active() ? 'host' : 'own'));

  /** Where the suggestion menu (`/`, `{{`) opens: by the trigger's line
      (`caret`), or docked in the foot, over the toolbar (`docked` — a
      phone, where the keyboard leaves no room by the caret). Set once, as
      the composer is created: the editor is handed the menu's element as
      it mounts. */
  suggestions = input<'caret' | 'docked'>('caret');

  /** The words on an empty line (Notion's way; the library's placeholder):
      a string for the hint under the caret, or words by kind — "Heading 1",
      "List", "Empty quote" on every empty block of that kind, an empty
      image's frame. The host words them in its language, built once per
      switch (a `computed`, never a pipe per kind): a language switch is a
      new value, shown at once. None by default. */
  placeholder = input<PlaceholderText>('');

  /** Which layout blocks take their gestures — a section's menu, the
      columns' drags and pills, a table's grips, drags, pills and menus —
      by type. Off, a block stands as laid out and its words still edit;
      the host's switch (the composer's settings). Every block, by default. */
  layoutInteraction = input<LayoutInteractivity>(LAYOUT_INTERACTIVE);

  /** The editing surface's own scheme — the text only, never the chrome
      around it, and apart from the app's theme: an email has no theme of
      its own to follow. `light` is the message on pure white, as it is
      written; `dark` is the message as Apple Mail shows it in dark mode —
      its surface and text, and the palette's colours in their dark
      as Dawn draws them (`createDarkRendering`: the engine of the
      reading pane and the thumbnails; see `[data-color-scheme]` in
      styles.scss). Light unless the host
      switches it; two-way, for a host whose switch lives outside. */
  colorScheme = model<EditorColorScheme>('light');

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
      as it comes over (`claim: claimDragEvent`, handed to it below) and the zone
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

  /** The placeholders were filled in — what became of them, for the
      host's message. Mod-Shift-Enter, the `/` row and the writer's
      button all end here. */
  placeholdersFilled = output<MergeTagResolutionReport>();
  /** The evaluator failed; the body is as it was. */
  placeholdersFailed = output<unknown>();

  /** A template from the `/` menu took the body's place: the message round
      it as the template keeps it, for the host's rows — the editor holds
      the body only. Not told for a template that keeps none. */
  templatePicked = output<TemplateEnvelope>();

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

  /** The suggestion menu's box, handed to its extension — one for every
      trigger: they never open together. */
  suggestionMenu = viewChild.required<SuggestionMenu, ElementRef<HTMLElement>>('suggestionMenu', {
    read: ElementRef,
  });
  /** The table menu and the link editors: the grips place the first, the
      link items open the others. */
  protected readonly tableMenu = viewChild.required(TableMenu);
  protected readonly linkEditor = viewChild.required(LinkEditor);
  protected readonly altTextEditor = viewChild.required(AltTextEditor);
  protected readonly suggestion = viewChild.required(ChatBasedSuggestion);

  /** The chat-based suggestion's button, for the toolbar's end while the
      strip is up and the toolbar shows — the bar takes it as its own. */
  protected readonly suggestionAction = computed(() => {
    const suggestion = this.suggestion();
    return this.toolbar() && suggestion.open() ? (suggestion.action() ?? null) : null;
  });

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

  /** What the bubble menu shows: the extension's state — except for a
      button the link editor was opened on, as long as it stays selected:
      one menu at a time, and closing the link editor brings none up in its
      place. Derived, not asked of a callback at some moment, so no order of
      events can put the two up together. */
  protected readonly bubbleShown = computed<BubbleMenuState>(() =>
    this.linkEditor().holdsButton() ? { isOpen: false, boundingBox: null } : this.bubbleMenuState(),
  );

  /** Which table grip was pressed, and where it sits: the row or column
      menu opens on it, and clears when the menu closes. Its band stays
      selected either way. */
  protected readonly tableHandle = signal<TableHandleTarget | null>(null);

  /** Which layout column's grip was pressed: the cell menu opens on it for
      the column, and clears when the menu closes. */
  protected readonly columnHandle = signal<ColumnHandleTarget | null>(null);

  /** Which band's grip was pressed: the section menu opens on it, and
      clears when the menu closes. */
  protected readonly sectionHandle = signal<SectionHandleTarget | null>(null);

  /** The cell menu's grip — a table cell's or a layout column's. */
  protected readonly cellHandle = computed(() => this.tableHandle() ?? this.columnHandle());

  /** Any grip's menu closed: none is open now. */
  protected closeHandles(): void {
    this.tableHandle.set(null);
    this.columnHandle.set(null);
    this.sectionHandle.set(null);
  }

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
    // A view that owns the scroll keeps the floating foot's room clear at
    // its end — told once the foot exists (a render in), for as long as
    // this composer lives.
    const owner = this.#scrollOwner;
    if (owner) {
      let release = (): void => {};
      afterNextRender(() => (release = owner.stickFoot(this.footRoom)));
      this.#destroyRef.onDestroy(() => release());
    }

    // Handed over, once per edit and once the editor has drawn the body:
    // the composer as wide as what the email draws.
    afterRenderEffect(() => {
      this.value();
      this.baseline();
      this.#fitWidth(this.scroll() === 'host' && !this.codeView());
    });

    this.#commands.connect({
      codeView: this.codeView,
      codeEditor: this.codeEditor,
      openLink: (options) => this.linkEditor().show(options),
      // The bubble menu is open over the image when its alt button is
      // pressed: its box is where the popover goes.
      openAltText: () => this.altTextEditor().show(this.bubbleMenuState().boundingBox),
    });

    // On an island, its start points (`MarqueeStart` — a zoomed window's
    // side room) start this editor's marquee, through the island.
    const release = this.#island?.marquee.register((event) => {
      const view = this.editor()?.view;
      return !!view && beginBlockMarquee(view, event);
    });
    if (release) this.#destroyRef.onDestroy(release);

    // A language switch: the editor's own widgets (the quoted history's
    // buttons) ask their words when the view updates — an empty
    // transaction is that update, and changes nothing else.
    effect(() => {
      this.i18n.lang();
      const editor = this.editor();
      untracked(() => editor?.view.dispatch(editor.state.tr.setMeta('addToHistory', false)));
    });

    // New words for empty lines: the host's pipe, after a language switch.
    effect(() => {
      const text = this.placeholder();
      const editor = this.editor();
      untracked(() => editor?.commands['setPlaceholder'](text));
    });

    // The layout blocks' gestures, on or off — on every editor mounted: a
    // remount starts from the kit's default. The plain-text kit has no
    // layout, nor the command.
    effect(() => {
      const interactivity = this.layoutInteraction();
      const editor = this.editor();
      untracked(() => editor?.commands['setLayoutInteraction']?.(interactivity));
    });

    // The quoted history from outside — a reply seeded, a draft restored.
    // One string, set rarely: applied at once, re-published as what the
    // schema kept. The editor's own changes come back equal and stop here.
    effect(() => {
      const quoted = this.quoted();
      const editor = this.editor();
      untracked(() => {
        if (!editor || quoted === editor.getQuoted()) return;
        editor.setQuoted(quoted);
        this.#publishQuoted(editor);
      });
    });
  }

  /** The quoted history this editor last published: a
      quote from outside that has not reached the editor yet (a draft
      restored before it mounted) is never overwritten by the editor's
      older one — only a change of the editor's own goes out. */
  #publishedQuoted: string | null = null;

  #publishQuoted(editor: Editor): void {
    const quoted = editor.getQuoted();
    if (quoted === this.#publishedQuoted) return;
    this.#publishedQuoted = quoted;
    this.quoted.set(quoted);
  }

  /** An editor was mounted — the first, or one on another kit: the bars
      and menus are bound to it, what floated over the old one is gone, and
      the quoted history as it stands is already published (set into the new
      one, never published back over). */
  protected onMounted(editor: Editor): void {
    // The bars show what this kit can do: a snippet's has no table.
    this.#commands.offered.set(this.#mountedFormat === 'snippet' ? SNIPPET_ITEMS : null);
    this.bubbleMenuState.set({ isOpen: false, boundingBox: null });
    this.closeHandles();
    this.suggestionState.set(undefined);
    this.#publishedQuoted = this.quoted();
    this.#commands.mount(editor);
  }

  /** The document changed: its quoted history may have (the trash, Edit). */
  protected onBodyChange(editor: Editor): void {
    this.#publishQuoted(editor);
  }

  /** The kit an HTML message is written with: the email kit and everything
      the composer adds to it — the assistant, the menus, the grips, the
      tokens, the images. */
  #htmlKit(): Extension[] {
    return [
      // The writing assistant: an extension of the composer's own. It
      // declares one action, `ai` — first in the kit, so first in the `/`
      // menu — which opens the chat-based suggestion: the answer is *proposed*
      // into the text under the caret (the library's content stream and
      // proposal, opted into here), and is the message's only on Apply.
      createAiWriter({ onAsk: (ask) => this.suggestion().show(ask) }),
      createContentStream(),
      createContentProposal(),
      ...emailExtensions.filter((extension) => extension.name !== 'quotedHistory'),
      this.#quotedHistory(),
      createPlaceholder({ text: this.placeholder() }),
      // The dark paper, drawn by Dawn — as the reading pane draws the mail.
      createDarkRendering({ scope: DARK_PAPER }),
      createBubbleMenu({
        updateDelay: 150,
        onStateChange: (state) => this.bubbleMenuState.set(state),
        // Its colour pane is its own: typing a hex there keeps it open.
        holdsFocus: '[color-picker]',
      }),
      // Notion's marquee: a drag from the paper's margin, or the room
      // between and below the blocks, selects the blocks it touches. It
      // starts only there, but on a paper island (a compose window) the
      // box is drawn on the whole island — over the title bar and the
      // envelope rows — while it still selects only blocks; elsewhere in
      // the scrolling paper (the editor's parent, by default).
      createBlockMarquee({ canvas: (view) => this.#island?.element ?? view.dom.parentElement! }),
      // The grips on each row's flank and above each column: pressing one
      // selects that band and hands the menu its target. Every command the
      // menu then runs is selection-relative, which is why the two halves
      // need nothing of each other.
      createTableHandles({
        onOpen: (target) => this.tableHandle.set(target),
        label: (kind, number) => this.i18n.t(`editor.table.${kind}Options`, { number }),
      }),
      // The caret column's grip on a columns block: the cell menu, for the
      // column — its fill, its lines' alignment, where it sits beside a
      // taller neighbour.
      createColumnHandles({
        onOpen: (target) => this.columnHandle.set(target),
        label: (number) => this.i18n.t('editor.table.columnOptions', { number }),
      }),
      // The caret band's grip, centred on its top edge: the section menu —
      // its colour, the image behind it, taking it away. A spacer's grip
      // opens the same menu, cut to its fill and Remove.
      createSectionHandles({
        onOpen: (target) => this.sectionHandle.set(target),
        label: () => this.i18n.t('editor.section.options'),
        spacerLabel: () => this.i18n.t('editor.spacer.options'),
        pageLabel: () => this.i18n.t('editor.page.options'),
      }),
      // The kit's commands under `/`, and the stores' groups: a template
      // takes the body's place, a snippet joins the line at the caret.
      this.#suggestionMenu([
        templateGroup(this.#templateSource, ({ envelope }) => {
          if (envelope) this.templatePicked.emit(envelope);
        }),
        snippetGroup(this.#snippetSource),
        examplesGroup(this.#examples),
      ]),
      // The dialect is the sponsor's: AngularJS expressions. Opt-in — a
      // Handlebars host installs its own dialect here instead.
      createAngularExpressions({ onDiagnostics: (d) => this.expressionDiagnostics.set(d) }),
      createTextMetrics({ onMetrics: (metrics) => this.bodyMetrics.set(metrics) }),
      createInlineImages({ registry: this.#images }),
      // A click on a button never follows it: it opens the link editor on
      // it, as on a text link — whose "Open link" is the way out. The caret
      // stays in the editor, the button selected as an image is on a click:
      // Delete removes it (and the popover with it); a click in the field
      // edits the link.
      createButtonEdit({ onEdit: () => this.linkEditor().show({ focus: false }) }),
      createImageDrag({
        // How the editor tells *this* zone an image drag is its own.
        claim: claimDragEvent,
        onChange: (over) => this.imageDrag.set(over),
      }),
      this.#sendIntent(),
      // Core's "Parse", done from the document: each distinct expression
      // goes to the evaluator raw (no HTML, so no `&amp;&amp;`), every
      // value comes back in as text in its token's place — one undo step.
      createMergeTagResolution({
        resolve: (expressions) => this.#mergeTags.resolve(expressions),
        onResolved: (report) => this.placeholdersFilled.emit(report),
        onError: (error) => this.placeholdersFailed.emit(error),
      }),
    ];
  }

  /** The kit a plain-text message is written with: lines, and the few
      things a plain-text mode keeps — its quoted history, the words on an
      empty line, its measures, and Mod-Enter to send. No menu, no grip, no
      token, nothing that formats. */
  #plainTextKit(): Extension[] {
    return [
      ...plainTextExtensions.filter((extension) => extension.name !== 'quotedHistory'),
      this.#quotedHistory(),
      createPlaceholder({ text: this.placeholder() }),
      // The dark paper, drawn by Dawn — as the reading pane draws the mail.
      createDarkRendering({ scope: DARK_PAPER }),
      createTextMetrics({ onMetrics: (metrics) => this.bodyMetrics.set(metrics) }),
      this.#sendIntent(),
    ];
  }

  /** The kit a snippet is written with: words and their formatting on the
      snippet kit, and what writing them takes — the words on an empty
      line, the bubble menu, `/` for the kit's own commands (lists,
      colours) and `{{` for tokens, the dialect's diagnostics. No
      template, snippet or example to drop in, nothing to send. */
  #snippetKit(): Extension[] {
    return [
      ...snippetExtensions,
      createPlaceholder({ text: this.placeholder() }),
      // The dark paper, drawn by Dawn — as the reading pane draws the mail.
      createDarkRendering({ scope: DARK_PAPER }),
      createBubbleMenu({
        updateDelay: 150,
        onStateChange: (state) => this.bubbleMenuState.set(state),
        // Its colour pane is its own: typing a hex there keeps it open.
        holdsFocus: '[color-picker]',
      }),
      // Its `/` rows, less the layout section: a list made for a message's
      // layout (flush, no room round it) is no snippet's.
      this.#suggestionMenu([], (item) => item.section !== 'layout'),
      createAngularExpressions({ onDiagnostics: (d) => this.expressionDiagnostics.set(d) }),
      createTextMetrics({ onMetrics: (metrics) => this.bodyMetrics.set(metrics) }),
    ];
  }

  /** The `/` menu's colour rows — the palette's, then the user's custom
      swatches — each swatch as it looks on the paper: drawn by Dawn on a
      dark one. A pick still applies the colour as written, the light one. */
  #colorRows(ctx: ExtensionContext): SuggestionItem[] {
    const rows = colorSuggestions(ctx, this.#palette, this.#customSwatches());
    if (this.colorScheme() !== 'dark') return rows;
    return rows.map((row) => (row.swatch ? { ...row, swatch: dawnDarkColor(row.swatch) } : row));
  }

  /**
   * One suggestion menu, a trigger per list: `/` for the kit's commands,
   * its colours and the groups it is handed, `{{` for the variable
   * catalogue — and any further one (`@`, `||`) is another entry here,
   * nothing else. The groups' sources are server-backed `pagedSource`s,
   * which wait for the typing to settle and remember their pages; where
   * the triggers' sessions overlap, the one nearest the caret opens.
   */
  #suggestionMenu(
    groups: readonly SuggestionItem[],
    keep: (item: SuggestionItem) => boolean = () => true,
  ): Extension {
    return createSuggestionMenu({
      element: this.suggestionMenu().nativeElement,
      onChange: (state) => this.suggestionState.set(state),
      triggers: [
        {
          trigger: '/',
          // Functions: asked whenever the menu opens, so a language
          // switch is heard without re-creating anything.
          label: () => this.i18n.t('editor.menu.slash.label'),
          placeholder: () => this.i18n.t('editor.menu.slash.placeholder'),
          // Rows by id — the kit's actions and the groups — in the
          // language in use, searched in it *and* in English.
          i18n: this.i18n.suggestionLabel,
          items: (ctx: ExtensionContext) =>
            bySection(
              [
                ...extensionSuggestions(ctx),
                ...this.#colorRows(ctx),
                ...groups,
              ].filter(keep),
              SLASH_SECTIONS,
            ),
          // The sections' headings, in the language in use — the
          // library words what the dictionary leaves out.
          sections: (id) => this.i18n.lookup(`editor.menu.sections.${id}`),
        },
        // `{{` right after any character, a path as the query, and never
        // for a caret inside a token already written: the preset's.
        mergeTagTrigger({
          label: () => this.i18n.t('editor.menu.tokens.label'),
          placeholder: () => this.i18n.t('editor.menu.tokens.placeholder'),
          source: this.#mergeTagSource,
        }),
      ],
    });
  }

  /** The quoted history, in the language in use (labels are asked as the
      widget draws). */
  #quotedHistory(): Extension {
    return createQuotedHistory({
      labels: {
        show: () => this.i18n.t('editor.quoted.show'),
        hide: () => this.i18n.t('editor.quoted.hide'),
        edit: () => this.i18n.t('editor.quoted.edit'),
        remove: () => this.i18n.t('editor.quoted.remove'),
      },
    });
  }

  /** A user's gesture (Mod-Enter, /send) goes out as the send output; a
      host asking for the payload (`intent()`) gets it handed back instead. */
  #sendIntent(): Extension {
    return createSendIntent({
      onSend: (intent) => {
        if (this.#capturing) this.#captured = intent;
        else this.send.emit(intent);
      },
    });
  }

  /** The kit of a format, as the editor mounts: the format's own, and what
      every kit takes — the caret scrolls clear of the floating foot. */
  #kitFor(format: ComposeKit): Extension[] {
    this.#mountedFormat = format;
    const kit =
      format === 'text'
        ? this.#plainTextKit()
        : format === 'snippet'
          ? this.#snippetKit()
          : this.#htmlKit();
    return [...kit, footClearance(this.#footRoom)];
  }

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /**
   * Handed over (`scroll: 'host'`), the composer grows with its text — down,
   * and across: an email wider than the column (a fixed-width table) runs
   * on past it, and the owner scrolls it sideways. Its own box must reach
   * as far, or its sticky foot stops short where the box does. A table's
   * min-content is its declared width, though, and a fixed-layout one round
   * a wider one draws past it (Poor Fix Width): so the box is held to what
   * the email really draws — its least taken away, read, put back where
   * wider, in one task: nothing is drawn between. Not in code view: the
   * source wraps in its pane.
   */
  #fitWidth(on: boolean): void {
    const host = this.#host;
    host.style.removeProperty('min-inline-size');
    if (!on) return;
    const width = host.scrollWidth;
    if (width > host.clientWidth) host.style.minInlineSize = `${width}px`;
  }

  /** The strip and the dock, floating over the foot of the text. */
  protected readonly foot = viewChild.required(FloatingFoot);

  /** What the foot covers of the text, as it stands — asked by the caret
      as it scrolls (`footClearance`). */
  readonly #footRoom = (): number => this.foot().room();

  /** What the foot covers of the text, px — for a host that scrolls the
      text itself (`scroll: 'host'`) to say so as its end scroll padding. */
  readonly footRoom = computed(() => this.foot().room());

  /** The foot grew over the text — the docked menu opening, the toolbar
      switched on: the caret, if it is being written at, comes back out from
      under it. */
  protected keepCaretClear(): void {
    const view = this.editor()?.view;
    if (view?.hasFocus()) view.dispatch(view.state.tr.scrollIntoView());
  }

  /**
   * The pane itself took focus — a host that made it focusable
   * (`tabindex="-1"`) and marked it where the caret should start
   * (`cdkFocusInitial`, which the CDK's initial focus lands on: a dialog's,
   * a focus trap's capture). The caret goes on into the text: now, or — the
   * editor mounts a render after the pane — as it mounts. Not into a
   * source pane standing in the editor's place.
   */
  protected onHostFocus(): void {
    if (!this.codeView()) this.body().focus();
  }

  /** Takes the caret the way a focus trap's initial focus does: the host
      (marked focusable for it) takes focus and hands the caret into the
      text — now, or as the editor mounts. */
  takeFocus(): void {
    this.#host.focus();
  }

  focusEditor(): void {
    this.#commands.focus();
  }

  /** The form's way in (`focusBoundControl` on the body field): the caret
      goes to the email editor — leaving code view first if the source is
      standing in its place, since a hidden editor cannot take focus. */
  focus(): void {
    if (!this.codeView()) {
      this.body().focus();
      return;
    }
    releaseEditingSurface();
    this.sourceView.set('hidden');
    afterNextRender({ write: () => this.body().focus() }, { injector: this.#injector });
  }
}

/** The `/` menu's sections, in reading order: what the writer reaches for
    first — the assistant, the blocks — down to the demo's own seeds. */
const SLASH_SECTIONS = [
  'ai',
  'blocks',
  'styling',
  'color',
  'media',
  'layout',
  'templates',
  'examples',
  'message',
] as const;

/** The rows in section order — each section's rows together, in their own
    order, so the menu heads them once; a row of no section, or of one the
    order does not name, goes last. */
function bySection<T extends { section?: string }>(items: T[], order: readonly string[]): T[] {
  const rank = (item: T) => {
    const index = item.section ? order.indexOf(item.section) : -1;
    return index < 0 ? order.length : index;
  };
  return items
    .map((item, index) => ({ item, index, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}
