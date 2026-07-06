import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,

  // Signals
  effect,
  model,
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
  BubbleMenuState,
  Editor,
  SlashMenuState,
  TextMetrics,
  createBubbleMenu,
  createEditor,
  createSlashMenu,
  createTextMetrics,
  defineExtension,
  emailExtensions,
  emailTextPalette,
} from 'angular-email-editor';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  /** Canonical email HTML, two-way bound by the parent composer. This editor
      owns the canonical form: whatever comes in is parsed through the email
      schema and re-published as what survived. */
  html = model('');

  editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  bubbleMenu = viewChild.required<ElementRef<HTMLElement>>('bubbleMenu');
  slashMenu = viewChild.required<ElementRef<HTMLElement>>('slashMenu');
  editor = signal<Editor | undefined>(undefined);
  slashState = signal<SlashMenuState | undefined>(undefined);

  // Our source of truth powered by the PM plugin
  menuState = signal<BubbleMenuState>({ isOpen: false, boundingBox: null });

  /** Curated dual-contrast text colors — the picker offers only these;
      arbitrary hex lives solely in the HTML source pane, on purpose. */
  palette = emailTextPalette;
  colorMenuOpen = signal(false);

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
      const incoming = this.html();
      const editor = this.editor();
      if (!editor || editor.view.hasFocus()) return;
      if (incoming === editor.getHTML()) return;

      editor.setContent(incoming);
      // Re-publish the canonical form: what survived the schema round-trip.
      this.html.set(editor.getHTML());
    });
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
        createSlashMenu({
          element: this.slashMenu().nativeElement,
          onChange: (state) => this.slashState.set(state),
        }),
        createTextMetrics({ onMetrics: (metrics) => this.bodyMetrics.set(metrics) }),
        this.#angularSync,
      ],
      attributes: { role: 'textbox', 'aria-label': 'Message body' },
      onUpdate: (editor) => this.html.set(editor.getHTML()),
    });
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

  isActive(name: string): boolean {
    this.#editorTick();
    return this.editor()?.isActive(name) ?? false;
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

  toggleLink() {
    const editor = this.editor();
    if (!editor) return;

    if (editor.isActive('link')) {
      editor.commands['unsetLink']();
    } else {
      const href = window.prompt('Link URL');
      if (href) editor.commands['setLink']({ href });
    }

    editor.focus();
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
