import {
  Component,
  Directive,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  computed,
  contentChildren,
  inject,
  input,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Material
import { MatIconModule } from '@angular/material/icon';

// Aria
import { Menu, MenuItem, MenuTrigger } from '@angular/aria/menu';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

import { PaperIslandScheme } from '../../../paper-island';

/** A row of a toolbar menu. */
export interface ToolbarMenuItem<V> {
  value: V;
  label: string;
  /** A leading glyph — the ⋯ menu's items carry their button's. */
  icon?: string;
  /** `radio`: one of a set, ticked at the item's end (font, size).
      `checkbox`: a toggle (a moved Bold) — ticked at its end too where it
      has no icon (the calendar's Show weekends). Plain otherwise. */
  kind?: 'radio' | 'checkbox';
  checked?: boolean;
  disabled?: boolean;
  /** Starts a new group: a separator stands before it. */
  separated?: boolean;
  /** Starts a new group under this heading — the ⋮ menu's View. */
  section?: string;
  /** Sets the label in this font — the font menu previews its stacks. */
  font?: string;
  /** Small letters at the item's end, before its tick, each lit or dimmed —
      the font menu's G A O: which mail clients draw the face. Decoration:
      `badgesTitle` says it in words, as a tooltip. */
  badges?: readonly { text: string; on: boolean }[];
  badgesTitle?: string;
  /** The key that does the same outside the menu, at the item's end —
      the calendar's views, Google's D W M. Said to assistive tech as
      `aria-keyshortcuts`. */
  shortcut?: string;
}

/**
 * A row of the menu's own, after its items: not an item but a control —
 * the ⋮ menu's View and Theme toggles, each with its word. The menu
 * renders the rows in order, each under the heading it is given, if any; a
 * click in one is not a choice, so the menu stays open, and the keys the
 * control acts on are its own — Up and Down move between rows (and up to
 * the items). A menu with no items puts focus on the first row's tab stop
 * when it opens.
 *
 * ```html
 * <div toolbar-menu …>
 *   <ng-template [toolbarMenuRow]="'Appearance'">
 *     <hk-tgb …>…</hk-tgb>
 *   </ng-template>
 * </div>
 * ```
 */
@Directive({ selector: 'ng-template[toolbarMenuRow]' })
export class ToolbarMenuRow {
  /** The row's heading, as a section's. */
  readonly heading = input<string | undefined>(undefined, { alias: 'toolbarMenuRow' });
  readonly template = inject(TemplateRef);
}

/**
 * A toolbar's dropdown menu: an Aria menu in a CDK overlay, opened by the
 * `ngMenuTrigger` it is given and anchored to it.
 *
 * ```html
 * <button ngMenuTrigger #trigger="ngMenuTrigger" [menu]="fonts.menu()">Font</button>
 * <div toolbar-menu #fonts [trigger]="trigger" label="Font" [items]="…" (selected)="…"></div>
 * ```
 *
 * The host takes no room (`display: contents`): it is only where the overlay
 * is declared, so it can stand anywhere in a row without adding a gap. The
 * menu opens above the toolbar (which sits under the text, and on the
 * keyboard on a phone), below when there is no room above — or the other
 * way round, for a trigger on a bar that heads its sheet (`side`).
 */
@Component({
  selector: 'div[toolbar-menu]',
  imports: [MatIconModule, Menu, MenuItem, NgTemplateOutlet, OverlayModule, PaperIslandScheme],
  templateUrl: './toolbar-menu.html',
  styleUrl: './toolbar-menu.scss',
})
export class ToolbarMenu<V> {
  readonly trigger = input.required<MenuTrigger<V>>();
  readonly label = input.required<string>();
  /** The menu's items. None for a menu of rows alone (`ToolbarMenuRow`). */
  /** The menu's items. None for a menu of rows alone (`ToolbarMenuRow`). */
  readonly items = input<readonly ToolbarMenuItem<V>[]>([]);
  /** Which edge of the trigger the menu lines up with — `end` for a ⋯ at a
      line's end. */
  readonly align = input<'start' | 'end'>('start');

  /** Which side of the trigger the menu tries first — the other when there
      is no room: `above` for a bar under the text, `below` for one heading
      the sheet. */
  readonly side = input<'above' | 'below'>('above');

  /** An item was chosen. The menu has closed and focus is back on the
      trigger. */
  readonly selected = output<V>();

  /** The Aria menu, for the trigger's `[menu]`. It renders inside the
      overlay, so it only exists while open. */
  readonly menu = viewChild<Menu<V>>(Menu);

  /** The host's own rows, in order (`ToolbarMenuRow`). */
  protected readonly rows = contentChildren(ToolbarMenuRow, { descendants: true });

  /** Where the rows are rendered, while open. */
  private readonly rowBoxes = viewChildren<ElementRef<HTMLElement>>('rowBox');

  readonly #injector = inject(Injector);

  protected readonly positions = computed<ConnectedPosition[]>(() => {
    const x = this.align();
    // `menu-above`: the pane says which way it opened, so the menu rises
    // into place from the trigger's side (styles.scss).
    const above: ConnectedPosition = {
      originX: x,
      originY: 'top',
      overlayX: x,
      overlayY: 'bottom',
      offsetY: -4,
      panelClass: 'menu-above',
    };
    const below: ConnectedPosition = {
      originX: x,
      originY: 'bottom',
      overlayX: x,
      overlayY: 'top',
      offsetY: 4,
    };
    return this.side() === 'above' ? [above, below] : [below, above];
  });

  /** The menu opened. The trigger puts focus on the first item — a menu of
      rows alone has none, so focus goes to the first row's tab stop
      instead, or it would stay on the trigger and Tab would walk out of the
      menu. */
  protected onAttach(): void {
    if (this.items().length) return;
    afterNextRender({ write: () => this.#focusRow(0) }, { injector: this.#injector });
  }

  /** Up and Down between rows, as between items: a row's control keeps the
      arrows across for itself. Past the first row Up is the menu's — to
      its items, where it has some. */
  protected stepRow(event: Event, index: number, by: 1 | -1): void {
    const next = index + by;
    if (next < 0 || next >= this.rowBoxes().length) return;
    event.preventDefault();
    event.stopPropagation();
    this.#focusRow(next);
  }

  /** Puts focus on a row's tab stop. */
  #focusRow(index: number): void {
    this.rowBoxes()[index]?.nativeElement.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }
}
