import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,

  // Signals
  effect,
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
  createInlineImages,
  createSendIntent,
  createSlashMenu,
  createTextMetrics,
  InlineImages,
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

@Component({
  selector: 'section[email-compose]',
  imports: [
    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // CDK
    OverlayModule,
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

  /** The send *intent*: canonical HTML + text/plain projection, emitted when
      the user asks to send (/send, Mod-Enter, toolbar). Envelope and
      transport are the host's — this is the whole send API. */
  send = output<SendIntent>();

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
    this.editor()?.focus();
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
    this.#editorTick();
    const editor = this.editor();
    return !!editor && undo(editor.state);
  }

  canRedo(): boolean {
    this.#editorTick();
    const editor = this.editor();
    return !!editor && redo(editor.state);
  }

  run(command: string) {
    const editor = this.editor();
    if (!editor) return;
    editor.commands[command]();
    editor.focus();
  }

  /** Applies a palette swatch to the selection, or `null` for automatic
      (unset). The palette popover prevents mousedown defaults, so the
      editor's selection survives the click; we refocus afterwards. */
  applyColor(color: string | null): void {
    this.colorMenuOpen.set(false);
    const editor = this.editor();
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
    const editor = this.editor();
    if (!editor) return;
    const { state } = editor;

    if (state.selection.empty && findTableContext(state)) {
      editor.commands['setCellBackground'](color);
    } else if (state.selection.empty && findColumnContext(state)) {
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
    const editor = this.editor();
    if (!editor) return;

    if (stack) editor.commands['setFontFamily'](stack);
    else editor.commands['unsetFontFamily']();
    editor.focus();
  }

  /** Applies a curated font size to the selection, or `null` to clear it. */
  applyFontSize(size: number | null): void {
    this.sizeMenuOpen.set(false);
    const editor = this.editor();
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
    const editor = this.editor();
    if (!editor) return;

    const { from, empty } = editor.state.selection;
    const range = linkRangeAt(editor.state, from);
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
    const editor = this.editor();
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
    const editor = this.editor();
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
