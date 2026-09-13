import { Component, computed, input, output, viewChild } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

// Aria
import { Menu, MenuItem, MenuTrigger } from '@angular/aria/menu';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

/** A row of a toolbar menu. */
export interface ToolbarMenuItem<V> {
  value: V;
  label: string;
  /** A leading glyph — the ⋯ menu's items carry their button's. */
  icon?: string;
  /** `radio`: one of a set, ticked at the item's end (font, size).
      `checkbox`: a toggle (a moved Bold). Plain otherwise. */
  kind?: 'radio' | 'checkbox';
  checked?: boolean;
  disabled?: boolean;
  /** Starts a new group: a separator stands before it. */
  separated?: boolean;
  /** Sets the label in this font — the font menu previews its stacks. */
  font?: string;
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
 * keyboard on a phone), below when there is no room above.
 */
@Component({
  selector: 'div[toolbar-menu]',
  imports: [MatIconModule, Menu, MenuItem, OverlayModule],
  templateUrl: './toolbar-menu.html',
  styleUrl: './toolbar-menu.scss',
})
export class ToolbarMenu<V> {
  readonly trigger = input.required<MenuTrigger<V>>();
  readonly label = input.required<string>();
  readonly items = input.required<readonly ToolbarMenuItem<V>[]>();
  /** Which edge of the trigger the menu lines up with — `end` for a ⋯ at a
      line's end. */
  readonly align = input<'start' | 'end'>('start');

  /** An item was chosen. The menu has closed and focus is back on the
      trigger. */
  readonly selected = output<V>();

  /** The Aria menu, for the trigger's `[menu]`. It renders inside the
      overlay, so it only exists while open. */
  readonly menu = viewChild<Menu<V>>(Menu);

  protected readonly positions = computed<ConnectedPosition[]>(() => {
    const x = this.align();
    return [
      { originX: x, originY: 'top', overlayX: x, overlayY: 'bottom', offsetY: -4 },
      { originX: x, originY: 'bottom', overlayX: x, overlayY: 'top', offsetY: 4 },
    ];
  });

  /** Closes the menu on a click outside it. The menu closes itself when
      focus leaves it — but toolbar buttons keep focus where it is on
      mousedown (so the editor keeps its caret), so a click on one would
      leave the menu open beside whatever it opened. Its own trigger is left
      to toggle it. */
  protected dismiss(event: MouseEvent): void {
    const trigger = this.trigger();
    if (trigger.element.contains(event.target as Node)) return;
    trigger.close();
  }
}
