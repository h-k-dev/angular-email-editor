import { Component, ElementRef, inject, input, viewChild } from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';

// CDK
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

// Library
import { BlockMenuState } from 'angular-email-editor';

import { FormattingCommands } from '../formatting-commands';

/**
 * The layout-block toolbar — the bubble menu's sibling, anchored to the
 * block the caret stands in rather than to a selection (it only opens on a
 * bare cursor, so the two never stack). Placed by the editor's block-menu
 * extension, whose state the composer feeds in.
 *
 * No table section: every table operation lives on the table itself —
 * adding rows and columns is the + pills (Tab past the last cell also
 * appends a row), deleting a table, row or column is select the whole
 * unit and press Delete, widths are the boundary and edge drags, fill is
 * the toolbar palette. The menu remains for the columns block, which has
 * not (yet) grown the same affordances.
 *
 * Reachable by keyboard: Alt-F10 moves focus in here (the extension's
 * gesture, which needs `element`); Escape hands it back to the text.
 */
@Component({
  selector: 'div[block-menu]',
  imports: [
    // Material
    MatButtonModule,
    MatDividerModule,
    MatIconModule,

    // CDK
    OverlayModule,
  ],
  templateUrl: './block-menu.html',
  styleUrl: './block-menu.scss',
})
export class BlockMenu {
  readonly #commands = inject(FormattingCommands);

  /** The extension's state: whether the menu shows, the block's own rect
      (viewport coordinates) and which block it is. */
  readonly state = input.required<BlockMenuState>();

  /** The toolbar element — only while open, as it renders in the overlay.
      The extension asks for it: to park focus in it on Alt-F10, and to tell
      focus in the menu from focus lost. */
  readonly element = viewChild<ElementRef<HTMLElement>>('menu');

  /** Below its block — it describes the whole structure, not the line being
      typed, and under the block it never covers the first row while
      writing. Flips above only when the bottom has no room. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  ];

  /** Runs a block command on the email editor — the block's, never the
      source pane's. */
  protected run(command: string): void {
    const editor = this.#commands.editor();
    if (!editor) return;
    editor.commands[command]();
    this.#restoreFocus();
  }

  /** Escape: back to the text. */
  protected leave(): void {
    this.#commands.focus();
  }

  /**
   * Where focus belongs after an action. A mouse user never left the editor
   * (the menu suppresses mousedown), so refocusing is a no-op. A keyboard
   * user is standing *in* the menu — yanking them back to the editor after
   * every button would make the menu unusable, so leave them there. Unless
   * the action dissolved the menu (delete), where the button they were on
   * is gone.
   */
  #restoreFocus(): void {
    const menu = this.element()?.nativeElement;
    if (this.state().isOpen && menu?.contains(document.activeElement)) return;
    this.#commands.editor()?.focus();
  }
}
