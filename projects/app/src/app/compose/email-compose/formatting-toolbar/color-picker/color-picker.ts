import { Component, inject, input, output } from '@angular/core';

// Library
import { KeepFocus } from 'angular-email-editor/focus';
import { injectPalette } from 'angular-email-editor/palette';

import { I18n } from '../../../../../services/i18n';
import { ColorPalette } from '../color-palette/color-palette';

let nextId = 0;

/**
 * The colour button's pane: the text palette and the background one side by
 * side, each under its name — Gmail's one colour button. When the viewport is
 * too narrow for both, the background palette wraps under the text one.
 *
 * The swatches are the palette in use — the library's unless the app
 * provides its own (`providePalette`).
 * Shows the colours in effect (`color`, `background`) and reports a pick
 * from either; the host applies it and closes the pane. A mousedown never
 * takes focus, so the editor's selection survives the click.
 */
@Component({
  selector: 'div[color-picker]',
  imports: [ColorPalette],
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.scss',
  hostDirectives: [KeepFocus],
  host: { role: 'group' },
})
export class ColorPicker {
  protected readonly i18n = inject(I18n);

  /** The text colour at the selection, or null for automatic. */
  readonly color = input<string | null>(null);
  /** The background at the selection, or null for none. */
  readonly background = input<string | null>(null);

  /** A text colour was picked, or null for automatic. */
  readonly colorPicked = output<string | null>();
  /** A background was picked, or null for none. */
  readonly backgroundPicked = output<string | null>();

  /** The palette in use (`EMAIL_PALETTE`): the library's, or the app's own. */
  readonly #palette = injectPalette();
  protected readonly textPalette = this.#palette.text;
  protected readonly backgroundPalette = this.#palette.background;

  protected readonly id = `color-picker-${nextId++}`;
}
