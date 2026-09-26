import {
  Component,
  ElementRef,
  TemplateRef,

  // Signals
  computed,
  linkedSignal,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// Library
import {
  PaletteColor,
  TableHandleTarget,
  duplicateColumn,
  duplicateRow,
  caretCellPos,
} from 'angular-email-editor';
import { injectPalette } from 'angular-email-editor/palette';
import { TextSelection } from 'prosemirror-state';
import { KeepFocus } from 'angular-email-editor/focus';

import { FormattingCommands } from '../formatting-commands';
import { Popover } from '../popover/popover';

/**
 * The menu a table grip opens: everything that can be done to one row or one
 * column, anchored to the grip that was pressed (the editor's table-handles
 * extension reports which band and where). A panel of the composer's one
 * popover: a grip pressed while it is up — the next row, or a column in
 * another table entirely — moves the anchor, and the popover follows.
 *
 * The band is already selected by the time this opens — that is what the
 * grip's press does — so every item here is the ordinary selection-relative
 * command, and the highlight on the row *is* the menu's subject being shown.
 *
 * It offers what is *structural* about a band and nothing else: insert one
 * either side, duplicate it, delete it. Formatting stays where formatting
 * lives — the band is selected when the menu opens, so the toolbar's fill,
 * alignment and every other command act on the whole row or column from
 * there, and the menu does not grow a second copy of the toolbar. Header
 * rows are not offered at all: an email table is presentational, and this
 * schema has no `<th>` (see the table node).
 */
@Component({
  selector: 'div[table-menu]',
  imports: [
    // Material
    MatIconModule,

    // Library
    KeepFocus,
  ],
  templateUrl: './table-menu.html',
  styleUrl: './table-menu.scss',
})
export class TableMenu {
  readonly #commands = inject(FormattingCommands);

  /** The grip that was pressed, or null while no menu is open. */
  readonly target = input.required<TableHandleTarget | null>();

  /** The menu asked to close — after an action, on Escape, on a click
      outside. The composer clears the target it passed in. */
  readonly closed = output<void>();

  /** The panel element, for the composer to tell focus inside it from focus
      lost, and for Escape to hand the caret back. */
  readonly element = viewChild<ElementRef<HTMLElement>>('menu');

  /** Row, column or cell — the band menus differ only in their words and
      icons; the cell's is its own (colour, alignment, clearing). */
  protected readonly kind = computed(() => this.target()?.kind ?? 'row');
  protected readonly isRow = computed(() => this.kind() === 'row');
  protected readonly isCell = computed(() => this.kind() === 'cell');

  /** The cell menu's page: its three items, or the colour list, or the
      alignment list — a second level in the same panel, with a way back.
      Back to the items whenever the menu opens anew. */
  protected readonly page = linkedSignal<TableHandleTarget | null, 'items' | 'color' | 'align'>({
    source: this.target,
    computation: () => 'items',
  });

  /** The palette in use — text colours and fills, as the colour list's rows. */
  protected readonly palette = injectPalette();

  /** Beside the grip it belongs to: a row's menu opens to its right, a
      column's below it, so neither covers the band it is about to change. */
  protected readonly positions = computed<ConnectedPosition[]>(() =>
    this.isRow() || this.isCell()
      ? [
          { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 4 },
          { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -4 },
        ]
      : [
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
        ],
  );

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  constructor() {
    // A click outside closes it — the band stays selected, so nothing is
    // lost by the menu going away.
    inject(Popover).register({
      layer: 'toolbar',
      open: () => !!this.target(),
      anchor: () => this.target()?.boundingBox ?? null,
      content: this.panel,
      positions: this.positions,
      onOutsideClick: () => this.closed.emit(),
      close: () => this.leave(),
    });
  }

  protected insert(where: 'before' | 'after'): void {
    const row = this.isRow();
    this.#run(
      where === 'before'
        ? row
          ? 'addRowBefore'
          : 'addColumnBefore'
        : row
          ? 'addRowAfter'
          : 'addColumnAfter',
    );
  }

  protected duplicate(): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    editor.exec(this.isRow() ? duplicateRow() : duplicateColumn());
    this.#done();
  }

  protected remove(): void {
    this.#run(this.isRow() ? 'deleteRow' : 'deleteColumn');
  }

  /** The cell's text colour: on all of the cell's words — the caret alone
      is in it, so the cell is selected for the mark and the caret put back. */
  protected colorText(color: PaletteColor | null): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    const pos = caretCellPos(editor.state);
    if (pos === null) return;
    const { selection } = editor.state;
    const cell = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos + 1, pos + cell.nodeSize - 1),
      ),
    );
    if (color) editor.commands['setColor'](color.value);
    else editor.commands['unsetColor']();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selection.from)),
    );
    this.#done();
  }

  /** The cell's fill, from the background palette — or none. */
  protected fill(color: PaletteColor | null): void {
    this.#run('setCellBackground', color?.value ?? null);
  }

  protected alignText(align: 'left' | 'center' | 'right'): void {
    this.#run('setCellAlignment', align);
  }

  protected alignVertically(valign: 'top' | 'middle' | 'bottom'): void {
    this.#run('setCellVerticalAlign', valign);
  }

  protected clear(): void {
    this.#run('clearCells');
  }

  /** Escape: the menu closes and the caret goes back to the text. */
  protected leave(): void {
    this.closed.emit();
    this.#commands.focus();
  }

  #run(command: string, ...args: unknown[]): void {
    this.#commands.editor()?.commands[command]?.(...args);
    this.#done();
  }

  /**
   * After an action: the menu has done its job and closes, the way a menu
   * does — unlike the block toolbar, which stays for the next press. What
   * the action changed is still selected, so the next gesture (a colour, a
   * second move) is one grip press away.
   */
  #done(): void {
    this.closed.emit();
    this.#commands.editor()?.focus();
  }
}
