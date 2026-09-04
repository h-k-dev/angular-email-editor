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
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { Portal, PortalModule } from '@angular/cdk/portal';

// ProseMirror
import { Plugin } from 'prosemirror-state';
import { redo, undo } from 'prosemirror-history';

// Library
import {
  BlockMenuState,
  BubbleMenuState,
  Editor,
  MergeTagItem,
  MergeTagMenuState,
  MergeTagPage,
  MergeTagRequest,
  SendIntent,
  SlashMenuState,
  TextMetrics,
  createBlockMenu,
  createBubbleMenu,
  createEditor,
  createMergeTagMenu,
  createAngularExpressions,
  createInlineImages,
  createSendIntent,
  createSlashMenu,
  createTextMetrics,
  ExpressionDiagnostic,
  InlineImages,
  mergeTagAt,
  defineExtension,
  emailBackgroundPalette,
  emailExtensions,
  emailFontFamilies,
  emailFontSizes,
  emailTextPalette,
  findColumnContext,
  findTableContext,
  linkRangeAt,
} from 'angular-email-editor';

/** Where the HTML source shows: nowhere, in the editing surface's place
    (code view), or beside the editor in its own column (detached). */
export type SourceView = 'hidden' | 'code' | 'detached';

@Component({
  selector: 'section[email-compose]',
  imports: [
    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // CDK
    OverlayModule,
    PortalModule,
  ],
  templateUrl: './email-compose.html',
  styleUrl: './email-compose.scss',
})
export class EmailCompose {
  #destroyRef = inject(DestroyRef);
  /** The composer's inline image registry — provided by the composer. */
  readonly #images = inject(InlineImages);

  /** Canonical email HTML, two-way bound by the parent composer. This editor
      owns the canonical form: whatever comes in is parsed through the email
      schema and re-published as what survived. */
  html = model('');

  /** How the HTML source shows, driven by the toolbar's two buttons. Two-way
      so the composer can flip it too (revealing a lint finding lands in the
      source). The composer owns the pane; this component only knows the
      slot it can offer (see `codePortal`). */
  sourceView = model<SourceView>('hidden');

  /** Code view (Summernote's </>): the source stands in the editing surface's
      place and the toolbar targets it. */
  codeView = computed(() => this.sourceView() === 'code');

  /** Whether the composer's preview pane shows (docked to the left — the
      only place it goes). The toolbar hosts the toggle; the composer owns
      the pane. */
  preview = model(false);

  /** Whether a pane can dock beside the editor at all. Off, the two dock-out
      buttons leave the toolbar — code view (in place) stays. The composer
      decides from the viewport. */
  dockable = input(true);

  /** The source pane as a DOM portal, attached into the code-view slot while
      `sourceView` is 'code' — the composer builds it, since it owns the
      pane; null otherwise, and the pane returns to its own column. */
  codePortal = input<Portal<unknown> | null>(null);

  /** The source pane's editor. Its kit mirrors every mark command and
      history, so in code view the toolbar's mark buttons act on *it* — the
      same command, on the visible text. */
  codeEditor = input<Editor | undefined>();

  readonly #injector = inject(Injector);
  /** The send *intent*: canonical HTML + text/plain projection, emitted when
      the user asks to send (/send, Mod-Enter, or {@link requestSend} from the
      writer's Send button). Envelope and transport are the host's — this is
      the whole send API. */
  send = output<SendIntent>();

  /** Asks for the send intent — the writer's Send button. Always the email
      editor: its send-intent extension builds the payload, and in code view
      its document is already the source's (it syncs while unfocused). */
  requestSend(): void {
    this.editor()?.commands['requestSend']();
  }

  editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  bubbleMenu = viewChild.required<ElementRef<HTMLElement>>('bubbleMenu');
  /** Only exists while the block menu is open (it renders in a CDK overlay). */
  blockMenu = viewChild<ElementRef<HTMLElement>>('blockMenu');
  slashMenu = viewChild.required<ElementRef<HTMLElement>>('slashMenu');
  mergeTagMenu = viewChild.required<ElementRef<HTMLElement>>('mergeTagMenu');
  editor = signal<Editor | undefined>(undefined);
  slashState = signal<SlashMenuState | undefined>(undefined);

  // Our source of truth powered by the PM plugin
  menuState = signal<BubbleMenuState>({ isOpen: false, boundingBox: null });

  /** The layout-block toolbar (tables/columns) — the bubble menu's sibling,
      anchored to the block instead of the selection. Mutually exclusive with
      the bubble menu: it only opens on a bare cursor. */
  blockMenuState = signal<BlockMenuState>({ isOpen: false, boundingBox: null, block: null });

  /** Curated dual-contrast text colors — the picker offers only these;
      arbitrary hex lives solely in the HTML source pane, on purpose. */
  palette = emailTextPalette;
  colorMenuOpen = signal(false);

  /** Curated dual-safe background fills; the picker routes them to the right
      scope (text highlight / table cell / column) based on the cursor. */
  backgroundPalette = emailBackgroundPalette;
  bgMenuOpen = signal(false);

  /** Curated, email-safe font stacks and phone-safe sizes — the pickers offer
      only these; free-form fonts/sizes live solely in the HTML source pane. */
  fontFamilies = emailFontFamilies;
  fontSizes = emailFontSizes;
  fontMenuOpen = signal(false);
  sizeMenuOpen = signal(false);

  /** Table-size picker: an 8×8 hover grid — sweep to preview, click to insert.
      The picked size reads columns × rows, the way the grid is swept. */
  tableSteps = Array.from({ length: 8 }, (_, i) => i);
  tableMenuOpen = signal(false);
  tablePick = signal({ cols: 2, rows: 2 });

  /** The `{{` autocomplete's live state — the app renders the listbox rows
      from it (items, highlight, loading rows) and calls `loadMore` from the
      scroll handler. Opening, filtering and paging live in the extension. */
  mergeMenuState = signal<MergeTagMenuState | undefined>(undefined);

  /** Stands in for the variable-catalogue backend: a labelled core plus
      enough generated custom fields to need paging, filtered server-side
      (the source owns matching) and answered a page at a time after a small
      latency. A real host swaps this for an HTTP call with the same shape. */
  #mergeTagCatalogue: MergeTagItem[] = [
    { path: 'firstName', label: 'First name' },
    { path: 'lastName', label: 'Last name' },
    { path: 'email', label: 'Email address' },
    { path: 'company.name', label: 'Company' },
    { path: 'unsubscribeUrl', label: 'Unsubscribe URL' },
    ...Array.from({ length: 80 }, (_, i) => ({
      path: `custom.field${i + 1}`,
      label: `Custom field ${i + 1}`,
    })),
  ];

  #fetchMergeTags = ({ query, cursor }: MergeTagRequest): Promise<MergeTagPage> =>
    new Promise((resolve) =>
      setTimeout(() => {
        const q = query.toLowerCase();
        const matches = this.#mergeTagCatalogue.filter(
          (tag) => tag.path.toLowerCase().includes(q) || tag.label?.toLowerCase().includes(q),
        );
        const start = cursor ? Number(cursor) : 0;
        const items = matches.slice(start, start + 20);
        const end = start + items.length;
        resolve({ items, nextCursor: end < matches.length ? String(end) : null });
      }, 150),
    );

  // Link editor popover, anchored at the selection.
  linkInput = viewChild<ElementRef<HTMLInputElement>>('linkInput');
  linkMenuOpen = signal(false);
  linkHref = signal('');
  linkExisting = signal(false);
  linkAnchor = signal<{ left: number; top: number; height: number } | null>(null);

  // CDK allows us to pass a custom element that implements getBoundingClientRect()
  // Change virtualOrigin to a simple object with a method
  virtualOrigin = {
    getBoundingClientRect: () => {
      const box = this.menuState().boundingBox;
      if (!box) return new DOMRect(0, 0, 0, 0);

      return box;
    },
  };

  overlayPositions: ConnectedPosition[] = [
    {
      originX: 'center',
      originY: 'top',
      overlayX: 'center',
      overlayY: 'bottom',
      offsetY: -8, // The gap between text and menu
    },
    // Fallback: If no room on top, flip to the bottom
    {
      originX: 'center',
      originY: 'bottom',
      overlayX: 'center',
      overlayY: 'top',
      offsetY: 8,
    },
  ];

  /** The block menu sits *below* its block — it describes the whole structure,
      not the line being typed, and under the block it never covers the first
      row while writing. Flips above only when the bottom has no room. */
  blockMenuPositions: ConnectedPosition[] = [
    {
      originX: 'center',
      originY: 'bottom',
      overlayX: 'center',
      overlayY: 'top',
      offsetY: 8,
    },
    {
      originX: 'center',
      originY: 'top',
      overlayX: 'center',
      overlayY: 'bottom',
      offsetY: -8,
    },
  ];

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

  /** Bumped on every ProseMirror transaction so toolbar bindings recompute. */
  #editorTick = signal(0);

  /** Bridges ProseMirror state updates into Angular's reactivity. */
  #angularSync = defineExtension({
    name: 'angularSync',
    plugins: () => [
      new Plugin({
        view: () => ({ update: () => this.#editorTick.update((tick) => tick + 1) }),
      }),
    ],
  });

  constructor() {
    afterNextRender(() => this.#mountEditor());

    this.#destroyRef.onDestroy(() => this.editor()?.destroy());

    // Incoming html (the source pane's edits) parses through the email
    // schema. Skipped while this editor has focus: then it is the origin of
    // the signal value, not a consumer. `setContent` dispatches no
    // transaction, so applying can't echo through `onUpdate`.
    effect(() => {
      this.html(); // track: any external write re-runs this
      const editor = this.editor();
      if (!editor || editor.view.hasFocus()) return;
      this.#applyIncoming(editor);
    });
  }

  /** Applies the signal's current value to the editor and re-publishes the
      canonical form (what survived the schema round-trip). */
  #applyIncoming(editor: Editor): void {
    const incoming = this.html();
    if (incoming === editor.getHTML()) return;
    editor.setContent(incoming);
    this.html.set(editor.getHTML());
  }

  #mountEditor(): void {
    const editor = createEditor({
      parent: this.editorHost().nativeElement,
      extensions: [
        ...emailExtensions,
        createBubbleMenu({
          updateDelay: 150,
          onStateChange: (state) => this.menuState.set(state),
        }),
        createBlockMenu({
          onStateChange: (state) => this.blockMenuState.set(state),
          menuElement: () => this.blockMenu()?.nativeElement,
        }),
        createSlashMenu({
          element: this.slashMenu().nativeElement,
          onChange: (state) => this.slashState.set(state),
        }),
        createMergeTagMenu({
          element: this.mergeTagMenu().nativeElement,
          getTags: this.#fetchMergeTags,
          debounce: 150,
          onChange: (state) => this.mergeMenuState.set(state),
        }),
        // The dialect is the sponsor's: AngularJS expressions. Opt-in — a
        // Handlebars host installs its own dialect here instead.
        createAngularExpressions({ onDiagnostics: (d) => this.expressionDiagnostics.set(d) }),
        createTextMetrics({ onMetrics: (metrics) => this.bodyMetrics.set(metrics) }),
        createInlineImages({ registry: this.#images }),
        createSendIntent({ onSend: (intent) => this.send.emit(intent) }),
        this.#angularSync,
      ],
      attributes: { role: 'textbox', 'aria-label': 'Message body' },
      onUpdate: (editor) => this.html.set(editor.getHTML()),
    });
    // External writes must survive focus: the sync effect skips while this
    // editor is focused — so on blur, catch up with whatever the signal says
    // *now*. Last writer wins: if our own typing published after the external
    // write, the values already agree and this is a no-op. Without this, an
    // async draft restore or import landing mid-edit would be dropped forever.
    editor.view.dom.addEventListener('blur', () => this.#applyIncoming(editor));
    this.editor.set(editor);
    this.html.set(editor.getHTML());
    editor.focus();
  }

  closeMenu() {
    this.menuState.update((s) => ({ ...s, isOpen: false }));
  }

  focusEditor(): void {
    this.#target()?.focus();
  }

  /** Flips code view. Whatever surface is focused is about to be hidden —
      release it first, so its blur catch-up publishes to the shared signal
      before the other view reads it. The editor regains the caret only once
      it is rendered again: focusing a hidden element is a no-op. */
  toggleSourceView(view: 'code' | 'detached'): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.sourceView.update((current) => (current === view ? 'hidden' : view));
    afterNextRender(() => this.focusEditor(), { injector: this.#injector });
  }

  /** The editor the toolbar acts on: the source pane while code view is up,
      the email editor otherwise. Node-level commands (lists, tables, …) never
      route here — the source kit has no twin for them, so their buttons lock. */
  #target(): Editor | undefined {
    return this.codeView() ? this.codeEditor() : this.editor();
  }

  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    this.#editorTick();
    return this.editor()?.isActive(name, attrs) ?? false;
  }

  /** Runs a block command from the block menu. */
  runBlock(command: string): void {
    const editor = this.editor();
    if (!editor) return;
    editor.commands[command]();
    this.#restoreFocus();
  }

  /**
   * Where focus belongs after a block-menu action. A mouse user never left the
   * editor (the menu suppresses mousedown), so refocusing is a no-op. A keyboard
   * user is standing *in* the menu — yanking them back to the editor after every
   * button would make the menu unusable, so leave them there. Unless the action
   * dissolved the menu (delete table), where the button they were on is gone.
   */
  #restoreFocus(): void {
    const menu = this.blockMenu()?.nativeElement;
    if (this.blockMenuState().isOpen && menu?.contains(document.activeElement)) return;
    this.editor()?.focus();
  }

  /** Paragraph alignment; `null` restores the default (left). */
  align(align: 'center' | 'right' | null): void {
    const editor = this.editor();
    if (!editor) return;
    editor.commands['setAlignment'](align);
    editor.focus();
  }

  canUndo(): boolean {
    const editor = this.#tracked();
    return !!editor && undo(editor.state);
  }

  canRedo(): boolean {
    const editor = this.#tracked();
    return !!editor && redo(editor.state);
  }

  /** The target editor, read so the binding recomputes when it changes: the
      email editor ticks on every transaction; the source pane publishes into
      the shared html on every doc change, which is when its undo depth moves. */
  #tracked(): Editor | undefined {
    this.#editorTick();
    this.html();
    return this.#target();
  }

  /** Runs a named command on the visible editor — a mark or history command
      exists on both kits; a block command only on the email editor, and its
      button is locked in code view. */
  run(command: string) {
    const editor = this.#target();
    if (!editor) return;
    editor.commands[command]?.();
    editor.focus();
  }

  /** Applies a palette swatch to the selection, or `null` for automatic
      (unset). The palette popover prevents mousedown defaults, so the
      editor's selection survives the click; we refocus afterwards. */
  applyColor(color: string | null): void {
    this.colorMenuOpen.set(false);
    const editor = this.#target();
    if (!editor) return;

    if (color) editor.commands['setColor'](color);
    else editor.commands['unsetColor']();
    editor.focus();
  }

  /** Applies a background fill to the most relevant scope: selected text gets an
      inline highlight; a bare cursor in a table cell or column fills that
      container; otherwise it's an inline highlight (stored, so it continues as
      you type). `null` clears whichever scope applies. */
  applyBackground(color: string | null): void {
    this.bgMenuOpen.set(false);
    const editor = this.#target();
    if (!editor) return;
    const { state } = editor;

    // The container scopes are the email editor's: the source has no cells.
    const bare = state.selection.empty && !this.codeView();
    if (bare && findTableContext(state)) {
      editor.commands['setCellBackground'](color);
    } else if (bare && findColumnContext(state)) {
      editor.commands['setColumnBackground'](color);
    } else if (color) {
      editor.commands['setBackgroundColor'](color);
    } else {
      editor.commands['unsetBackgroundColor']();
    }
    editor.focus();
  }

  /** Applies a curated font stack to the selection, or `null` to clear it. */
  applyFontFamily(stack: string | null): void {
    this.fontMenuOpen.set(false);
    const editor = this.#target();
    if (!editor) return;

    if (stack) editor.commands['setFontFamily'](stack);
    else editor.commands['unsetFontFamily']();
    editor.focus();
  }

  /** Applies a curated font size to the selection, or `null` to clear it. */
  applyFontSize(size: number | null): void {
    this.sizeMenuOpen.set(false);
    const editor = this.#target();
    if (!editor) return;

    if (size) editor.commands['setFontSize'](size);
    else editor.commands['unsetFontSize']();
    editor.focus();
  }

  /** Infinite scroll: nearing the listbox's end fetches the next page. The
      extension makes `loadMore` a safe no-op while loading or exhausted. */
  onMergeMenuScroll(): void {
    const el = this.mergeTagMenu().nativeElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      this.mergeMenuState()?.loadMore();
    }
  }

  /** Opens the picker at the command's default size, so the preview never
      starts from a stale sweep of the previous open. */
  toggleTableMenu(): void {
    this.tablePick.set({ cols: 2, rows: 2 });
    this.tableMenuOpen.update((open) => !open);
  }

  /** Inserts the picked table. The picker speaks columns × rows;
      `insertTable` takes rows first. */
  insertTable(cols: number, rows: number): void {
    this.tableMenuOpen.set(false);
    const editor = this.editor();
    if (!editor) return;

    editor.commands['insertTable'](rows, cols);
    editor.focus();
  }

  /** Opens the link popover at the selection: prefilled when the cursor sits
      in an existing link, a no-op when there is neither selection nor link. */
  openLinkEditor(): void {
    const editor = this.#target();
    if (!editor) return;

    const { from, empty } = editor.state.selection;
    // The source pane has no link mark to read back: there it is insert-only,
    // on a selection.
    const range = this.codeView() ? undefined : linkRangeAt(editor.state, from);
    if (empty && !range) {
      editor.focus();
      return;
    }

    this.linkHref.set(range?.attrs.href ?? '');
    this.linkExisting.set(!!range);
    const coords = editor.view.coordsAtPos(from);
    this.linkAnchor.set({ left: coords.left, top: coords.top, height: coords.bottom - coords.top });
    this.linkMenuOpen.set(true);
    setTimeout(() => this.linkInput()?.nativeElement.select());
  }

  closeLinkEditor(): void {
    this.linkMenuOpen.set(false);
    this.focusEditor();
  }

  /** Applies the entered URL; a scheme-less value gets https:// prepended,
      an emptied value unlinks — matching what the field visibly says. */
  applyLink(): void {
    const editor = this.#target();
    const raw = this.linkHref().trim();
    this.linkMenuOpen.set(false);
    if (!editor) return;

    if (raw) {
      const href = /^[a-z][\w+.-]*:/i.test(raw) ? raw : `https://${raw}`;
      editor.commands['setLink']({ href });
    } else {
      editor.commands['unsetLink']();
    }
    editor.focus();
  }

  removeLink(): void {
    this.linkMenuOpen.set(false);
    const editor = this.#target();
    editor?.commands['unsetLink']();
    editor?.focus();
  }

  visitLink(): void {
    const href = this.linkHref();
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  }

  toggleBlockquote(): void {
    const editor = this.editor();
    if (!editor) return;

    if (editor.isActive('blockquote')) {
      editor.commands['liftBlock']();
    } else {
      editor.commands['wrapInBlockquote']();
    }
    editor.focus();
  }
}
