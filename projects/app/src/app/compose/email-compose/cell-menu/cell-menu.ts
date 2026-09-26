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
import { PaletteColor, TableHandleTarget, caretCellPos } from 'angular-email-editor';
import { injectPalette } from 'angular-email-editor/palette';
import { TextSelection } from 'prosemirror-state';

import { FormattingCommands } from '../formatting-commands';
import { Popover } from '../popover/popover';

/** What a row of the menu does, as the item's value: `text:<hex>` or
    `text:` (default), `fill:<hex>` or `fill:` (none), `align:<left|center|
    right>`, `valign:<top|middle|bottom>`, `clear`. */
type CellAction = string;

/**
 * The cell's menu, Notion's: the grip on the caret cell's edge opens it —
 * Color, Alignment, Clear contents — and its lists open beside their rows
 * on hover, or on the right arrow, as a cascading menu does. A panel of the
 * composer's one popover, anchored to the grip.
 *
 * Built on Angular Aria's menu (`ngMenu`, `ngMenuItem` with `submenu`):
 * the keys are the menu's while it is up — arrows walk it, Right and
 * Enter open a list, Left closes one, typing jumps to a row, Escape
 * leaves — which is why, unlike the band menus, this one *takes* focus
 * when it opens and hands it back to the text when it closes. The caret
 * stays where it was: every action reads the selection the editor kept.
 * A list runs past the screen, so it scrolls.
 */
@Component({
  selector: 'div[cell-menu]',
  imports: [
    // Material
    MatIconModule,

    // Angular Aria
    Menu,
    MenuItem,
  ],
  templateUrl: './cell-menu.html',
  styleUrl: './cell-menu.scss',
})
export class CellMenu {
  readonly #commands = inject(FormattingCommands);

  /** The grip that was pressed — this menu's when it is a cell's. */
  readonly target = input.required<TableHandleTarget | null>();

  /** The menu asked to close — after an action, on Escape, on a click
      outside. The composer clears the target it passed in. */
  readonly closed = output<void>();

  /** The palette in use — text colours and fills, as the colour list's rows. */
  protected readonly palette = injectPalette();

  protected readonly open = computed(() => this.target()?.kind === 'cell');

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

  /** Where a list stands: its first row level with its row — the row's
      offset in the menu less the menu's padding, which the list has again
      above its own first row. */
  protected subTop(item: MenuItem<CellAction>): number {
    const menu = item.element.offsetParent;
    const padding = menu ? parseFloat(getComputedStyle(menu).paddingTop) || 0 : 0;
    return item.element.offsetTop - padding;
  }

  protected pick(action: CellAction): void {
    const [kind, value = ''] = action.split(':') as [string, string?];
    switch (kind) {
      case 'text':
        this.colorText(value || null);
        break;
      case 'fill':
        this.#run('setCellBackground', value || null);
        break;
      case 'align':
        this.#run('setCellAlignment', value);
        break;
      case 'valign':
        this.#run('setCellVerticalAlign', value);
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

  protected textRow(color: PaletteColor | null): string {
    return `text:${color?.value ?? ''}`;
  }

  protected fillRow(color: PaletteColor | null): string {
    return `fill:${color?.value ?? ''}`;
  }

  /** The cell's text colour: on all of the cell's words — the caret alone
      is in it, so the cell is selected for the mark and the caret put back. */
  private colorText(color: string | null): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    const pos = caretCellPos(editor.state);
    if (pos === null) return;
    const { from } = editor.state.selection;
    const cell = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, pos + 1, pos + cell.nodeSize - 1),
      ),
    );
    if (color) editor.commands['setColor'](color);
    else editor.commands['unsetColor']();
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
