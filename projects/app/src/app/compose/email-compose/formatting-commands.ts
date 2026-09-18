import { Service, Signal, computed, inject, signal } from '@angular/core';

// ProseMirror
import { redo, undo } from 'prosemirror-history';

// Library
import { Editor, findColumnContext, findTableContext, isMarkActive } from 'angular-email-editor';
import { editorState, injectActions } from 'angular-email-editor/actions';

import { I18n } from '../../../services/i18n';
import { FormattingItem, formattingItems } from './formatting-items';

/** What the composer hands the commands: the source pane's editor and
    whether it stands in the email editor's place (code view), the html both
    editors publish into, and the link editor to open at the text. */
export interface FormattingHost {
  codeView: Signal<boolean>;
  codeEditor: Signal<Editor | undefined>;
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

  readonly #i18n = inject(I18n);

  /** A button's words in the language in use: the bar's own where they
      differ from the row's ("Insert table" / "Table"), else the action's
      title, else the English the item carries. Reactive. */
  label(item: FormattingItem): string {
    return this.#i18n.t(
      `editor.toolbar.${item.id}`,
      this.#i18n.t(`editor.actions.${item.id}.title`, item.label),
    );
  }

  /** Every formatting button, bound to these commands — defined once; a
      surface picks a layout of them (`layoutEntries`). */
  readonly items = formattingItems(this);

  /** The actions of the visible editor — the source pane while code view is
      up, the email editor otherwise — bound and live. What an extension
      declares needs no entry of its own here: the items read it by id. */
  readonly actions = injectActions(() => this.target(), {
    // The one formatting item that is a dialog, not a command: the composer's
    // own action. "On" where the caret stands in a link — in an editor that
    // has links at all.
    host: [
      {
        id: 'link',
        run: () => this.#host()?.openLink(),
        isActive: (state) => {
          const link = state.schema.marks['link'];
          return !!link && isMarkActive(state, link);
        },
      },
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

  /** The email editor's state, as a signal — a binding that reads it
      recomputes on every transaction. */
  readonly state = editorState(() => this.editor());

  /** The editor the toolbar acts on: the source pane while code view is up,
      the email editor otherwise. */
  target(): Editor | undefined {
    return this.codeView() ? this.#host()?.codeEditor() : this.editor();
  }

  /** Whether a mark or node is on at the email editor's selection. A mark
      matches by type alone; for one attribute of it, see `markAttrs`. */
  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    this.state();
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

  /** The target editor, read so a binding recomputes on its transactions —
      whichever editor it is: the actions watch the visible one. */
  #tracked(): Editor | undefined {
    this.actions.state();
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

  /** Runs the action of that id on the visible editor, and hands the caret
      back to it. Nothing happens for an action the visible editor's kit does
      not have. */
  act(id: string): void {
    const action = this.actions.get(id);
    if (!action) return;
    action.run();
    // What the composer's own action opened has the focus now.
    if (!action.external) action.focus();
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
