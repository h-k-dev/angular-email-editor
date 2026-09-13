import { Service, Signal, computed, signal } from '@angular/core';

// ProseMirror
import { Plugin } from 'prosemirror-state';
import { redo, undo } from 'prosemirror-history';

// Library
import { Editor, defineExtension, findColumnContext, findTableContext } from 'angular-email-editor';

import { formattingItems } from './formatting-items';

/** What the composer hands the commands: the source pane's editor and
    whether it stands in the email editor's place (code view), the html both
    editors publish into, and the link editor to open at the text. */
export interface FormattingHost {
  codeView: Signal<boolean>;
  codeEditor: Signal<Editor | undefined>;
  /** Moves on every doc change of either editor — the source pane has no
      transaction bridge of its own, and its undo depth moves with it. */
  html: Signal<string>;
  /** Opens the link editor, anchored at the text — the one formatting item
      that is a dialog, not a command. */
  openLink: () => void;
}

/**
 * The formatting commands of one composer, and the editor state they read —
 * shared by everything that formats: the toolbar, the bubble menu, the ⋯
 * menu. Provided by the composer (`EmailCompose`), which mounts the editor
 * and connects its code view; nothing else provides it.
 *
 * Mark and history commands go to the *visible* editor (`target`): the
 * source pane while code view is up — its kit mirrors every mark command —
 * the email editor otherwise. Node-level commands (lists, quote, alignment,
 * tables) have no source-side twin: they always act on the email editor, and
 * their buttons lock in code view.
 */
@Service({ autoProvided: false })
export class FormattingCommands {
  readonly #editor = signal<Editor | undefined>(undefined);

  /** The email editor, once the composer has mounted it. */
  readonly editor = this.#editor.asReadonly();

  readonly #host = signal<FormattingHost | undefined>(undefined);

  /** Bumped on every ProseMirror transaction so bindings recompute. */
  readonly #tick = signal(0);

  /** Every formatting button, bound to these commands — defined once; a
      surface picks a layout of them (`layoutEntries`). */
  readonly items = formattingItems(this, { link: () => this.#host()?.openLink() });

  /** Bridges the email editor's state updates into Angular's reactivity —
      the composer installs it with the editor's extensions. */
  readonly sync = defineExtension({
    name: 'angularSync',
    plugins: () => [
      new Plugin({
        view: () => ({ update: () => this.#tick.update((tick) => tick + 1) }),
      }),
    ],
  });

  /** Connects the composer's code view and link editor. Called once, as the
      composer is created. */
  connect(host: FormattingHost): void {
    this.#host.set(host);
  }

  /** Hands over the email editor, once the composer has mounted it. */
  mount(editor: Editor): void {
    this.#editor.set(editor);
  }

  /** Code view: the source stands in the editing surface's place. */
  readonly codeView = computed(() => this.#host()?.codeView() ?? false);

  /** The email editor, read so a binding recomputes on its transactions. */
  readonly state = computed(() => {
    this.#tick();
    return this.editor()?.state;
  });

  /** The editor the toolbar acts on: the source pane while code view is up,
      the email editor otherwise. */
  target(): Editor | undefined {
    return this.codeView() ? this.#host()?.codeEditor() : this.editor();
  }

  /** Whether a mark or node is on at the email editor's selection. A mark
      matches by type alone; for one attribute of it, see `markAttrs`. */
  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    this.#tick();
    return this.editor()?.isActive(name, attrs) ?? false;
  }

  /** The attributes of a mark at the email editor's caret — a stored mark
      about to be typed in, or else the marks the caret stands in — or null
      when the mark is not on there. `textStyle` carries colour, font and
      size together, so a button that asks for one of them reads it here. */
  markAttrs(name: string): Record<string, unknown> | null {
    const state = this.state();
    if (!state) return null;
    const { $from } = state.selection;
    const marks = state.storedMarks ?? $from.marks();
    return marks.find((mark) => mark.type.name === name)?.attrs ?? null;
  }

  /** The target editor, read so a binding recomputes when it changes: the
      email editor ticks on every transaction; the source pane publishes into
      the shared html on every doc change, which is when its undo depth moves. */
  #tracked(): Editor | undefined {
    this.#tick();
    this.#host()?.html();
    return this.target();
  }

  readonly canUndo = computed(() => {
    const editor = this.#tracked();
    return !!editor && undo(editor.state);
  });

  readonly canRedo = computed(() => {
    const editor = this.#tracked();
    return !!editor && redo(editor.state);
  });

  focus(): void {
    this.target()?.focus();
  }

  /** Runs a named command on the visible editor — a mark or history command
      exists on both kits; a block command only on the email editor, and its
      button is locked in code view. */
  run(command: string): void {
    const editor = this.target();
    if (!editor) return;
    editor.commands[command]?.();
    editor.focus();
  }

  /** Paragraph alignment; `null` restores the default (left). */
  align(align: 'center' | 'right' | null): void {
    const editor = this.editor();
    if (!editor) return;
    editor.commands['setAlignment'](align);
    editor.focus();
  }

  toggleBlockquote(): void {
    const editor = this.editor();
    if (!editor) return;
    if (editor.isActive('blockquote')) editor.commands['liftBlock']();
    else editor.commands['wrapInBlockquote']();
    editor.focus();
  }

  /** Applies a palette swatch to the selection, or `null` for automatic
      (unset). The palette prevents mousedown defaults, so the editor's
      selection survives the click; the editor is refocused afterwards. */
  applyColor(color: string | null): void {
    const editor = this.target();
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
    const editor = this.target();
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

  /** Applies a curated font stack to the selection — or, for `null` (the
      font menu's own-font item), takes the chosen one off. */
  applyFontFamily(stack: string | null): void {
    const editor = this.target();
    if (!editor) return;
    if (stack) editor.commands['setFontFamily'](stack);
    else editor.commands['unsetFontFamily']();
    editor.focus();
  }

  /** Applies a curated font size in px — or, for `null`, takes the chosen
      one off. */
  applyFontSize(size: number | null): void {
    const editor = this.target();
    if (!editor) return;
    if (size) editor.commands['setFontSize'](size);
    else editor.commands['unsetFontSize']();
    editor.focus();
  }

  /** Inserts a table. Pickers speak columns × rows; `insertTable` takes rows
      first. */
  insertTable({ cols, rows }: { cols: number; rows: number }): void {
    const editor = this.editor();
    if (!editor) return;
    editor.commands['insertTable'](rows, cols);
    editor.focus();
  }
}
