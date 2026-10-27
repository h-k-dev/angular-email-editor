import {
  Component,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

// Angular Aria
import { Menu, MenuItem } from '@angular/aria/menu';

// CDK
import { ConnectedPosition } from '@angular/cdk/overlay';

// Library
import {
  ColumnHandleTarget,
  TableHandleTarget,
  caretCellPos,
  findColumnContext,
  toEmailSafeColor,
} from '@h-k-dev/angular-email-editor';
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';
import { TextSelection } from 'prosemirror-state';

import { FormattingCommands } from '../formatting-commands';
import { Popover } from '../popover/popover';
import { MenuSafeTriangle } from '../../../../../../core/utils/cascade-menu/safe-triangle';
import { SubmenuPlacement } from '../../../../../../core/utils/cascade-menu/submenu-placement';
import { FloatingScrollbar } from '../../../../common/floating-scrollbar/floating-scrollbar';

/** What a row of the menu does, as the item's value: `text:<hex>` or
    `text:` (default), `fill:<hex>` or `fill:` (none), `align:<left|center|
    right>`, `valign:<top|middle|bottom>`, `clear`. */
type CellAction = string;

/**
 * The cell's menu, Notion's: the grip on the caret cell's edge opens it —
 * Color, Alignment, Clear contents — and so does a columns block's grip on
 * the caret column's edge, for the column (no clearing there: a column's
 * content is blocks, taken away the usual way). Its lists open beside their rows
 * on hover, or on the right arrow, as a cascading menu does — on the side
 * with room, pushed into the screen (`SubmenuPlacement`). A panel of the
 * composer's one popover, anchored to the grip.
 *
 * Built on Angular Aria's menu (`ngMenu`, `ngMenuItem` with `submenu`):
 * the keys are the menu's while it is up — arrows walk it, Right and
 * Enter open a list, Left closes one, typing jumps to a row, Escape
 * leaves — and the pointer has menu-aim's grace on its way from a row to
 * its list (`MenuSafeTriangle`) — which is why, unlike the band menus, this
 * one *takes* focus when it opens and hands it back to the text when it
 * closes. The caret stays where it was: every action reads the selection
 * the editor kept. A list runs past the screen, so it scrolls.
 */
@Component({
  selector: 'div[cell-menu]',
  imports: [
    // Material
    MatIconModule,

    // Angular Aria
    Menu,
    MenuItem,
    MenuSafeTriangle,
    SubmenuPlacement,
    FloatingScrollbar,
  ],
  templateUrl: './cell-menu.html',
  styleUrl: './cell-menu.scss',
})
export class CellMenu {
  readonly #commands = inject(FormattingCommands);

  /** The grip that was pressed — this menu's when it is a cell's or a
      layout column's. */
  readonly target = input.required<TableHandleTarget | ColumnHandleTarget | null>();

  /** The menu asked to close — after an action, on Escape, on a click
      outside. The composer clears the target it passed in. */
  readonly closed = output<void>();

  /** The palette in use — text colours and fills, as the colour list's rows. */
  protected readonly palette = injectPalette();

  protected readonly open = computed(() => {
    const kind = this.target()?.kind;
    return kind === 'cell' || kind === 'layout-column';
  });

  /** A layout column's menu, not a table cell's: its commands are the
      column's, and it has nothing to clear. */
  protected readonly column = computed(() => this.target()?.kind === 'layout-column');

  /** What the colour list ticks, as the menu opened: the cell's (or the
      column's) fill and the text colour at the caret, as lower-case hex —
      null for none. */
  protected readonly current = computed(() => {
    const none = { fill: null as string | null, text: null as string | null };
    // Read again for every grip pressed — another cell's, with the menu up.
    const editor = this.target() && this.open() ? this.#commands.editor() : null;
    if (!editor) return none;
    const { state } = editor;
    const pos = this.column() ? (findColumnContext(state)?.pos ?? null) : caretCellPos(state);
    const fill = pos === null ? null : state.doc.nodeAt(pos)?.attrs['background'];
    const text = state.selection.$from
      .marks()
      .find((mark) => mark.type.name === 'textStyle')?.attrs['color'];
    const hex = (value: unknown) =>
      typeof value === 'string' ? (toEmailSafeColor(value)?.toLowerCase() ?? null) : null;
    return { fill: hex(fill), text: hex(text) };
  });

  /** The colour list's rows — text colours, then fills — each with whether
      it is the current one. */
  protected readonly texts = computed(() => {
    const current = this.current().text;
    return this.palette.text.map((color) => ({
      ...color,
      checked: color.value.toLowerCase() === current,
    }));
  });

  protected readonly fills = computed(() => {
    const current = this.current().fill;
    return this.palette.background.map((color) => ({
      ...color,
      checked: color.value.toLowerCase() === current,
    }));
  });

  /** The root menu's element, to put the focus in once it is on screen. */
  readonly element = viewChild<ElementRef<HTMLElement>>('menu');

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly panel = viewChild<TemplateRef<unknown>>('panel');

  /** To the right of the grip, top aligned — over the cells to the right,
      never over the one it is about; to the left where the right has no
      room. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 6 },
    { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -6 },
  ];

  constructor() {
    inject(Popover).register({
      layer: 'toolbar',
      open: () => this.open(),
      anchor: () => this.target()?.boundingBox ?? null,
      content: this.panel,
      positions: () => this.positions,
      onOutsideClick: () => this.closed.emit(),
      close: () => this.leave(),
    });
    // The keys are the menu's while it is up: focus goes in — onto the
    // active row, the first (roving focus: the one row with `tabindex="0"`,
    // set by the menu's own render, hence one render later) — once the
    // popover has rendered the menu.
    const injector = inject(Injector);
    effect(() => {
      const menu = this.open() ? this.element()?.nativeElement : undefined;
      if (!menu) return;
      untracked(() =>
        afterNextRender(
          {
            write: () => {
              const row = menu.querySelector<HTMLElement>('[tabindex="0"], [ngMenuItem]');
              (row ?? menu).focus();
            },
          },
          { injector },
        ),
      );
    });
  }

  protected pick(action: CellAction): void {
    const [kind, value = ''] = action.split(':') as [string, string?];
    switch (kind) {
      case 'text':
        this.colorText(value || null);
        break;
      case 'fill':
        this.#run(this.column() ? 'setColumnBackground' : 'setCellBackground', value || null);
        break;
      case 'align':
        if (this.column()) this.alignColumn(value);
        else this.#run('setCellAlignment', value);
        break;
      case 'valign':
        this.#run(this.column() ? 'setColumnVerticalAlign' : 'setCellVerticalAlign', value);
        break;
      case 'clear':
        this.#run('clearCells');
        break;
      default:
        return; // a list's row: opening it is Aria's
    }
  }

  /** Escape: the menu closes and the caret goes back to the text. */
  protected leave(): void {
    this.closed.emit();
    this.#commands.focus();
  }

  /** The cell's text colour — or the column's: on all of its words. The
      caret alone is in it, so the whole of it is selected for the mark and
      the caret put back. */
  private colorText(color: string | null): void {
    this.#acrossAll(() => {
      const editor = this.#commands.editor()!;
      if (color) editor.commands['setColor'](color);
      else editor.commands['unsetColor']();
    });
  }

  /** A column's alignment is its lines': every one of them, at once. */
  private alignColumn(align: string): void {
    this.#acrossAll(() =>
      this.#commands.editor()!.commands['setAlignment'](align === 'left' ? null : align),
    );
  }

  /** Runs `apply` with the whole of the caret's cell — or column — selected,
      then puts the caret back where it was. */
  #acrossAll(apply: () => void): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    const pos = this.column()
      ? (findColumnContext(editor.state)?.pos ?? null)
      : caretCellPos(editor.state);
    if (pos === null) return;
    const { from } = editor.state.selection;
    const node = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.between(
          editor.state.doc.resolve(pos + 1),
          editor.state.doc.resolve(pos + node.nodeSize - 1),
        ),
      ),
    );
    apply();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)),
    );
    this.#done();
  }

  #run(command: string, ...args: unknown[]): void {
    this.#commands.editor()?.commands[command]?.(...args);
    this.#done();
  }

  /** An action closes the menu and hands the caret back. */
  #done(): void {
    this.closed.emit();
    this.#commands.editor()?.focus();
  }
}
