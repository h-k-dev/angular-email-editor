import { Component, input, output } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';

/**
 * A curated swatch picker: the text palette (dual-contrast — every swatch
 * reads on both white and near-black, so it survives forced dark-mode
 * inversion) or the background one (pale tints that keep text readable
 * either way). No hex input: arbitrary colours live solely in the HTML
 * source, on purpose.
 *
 * The host names the palette (`aria-label`). A mousedown never takes focus,
 * so the editor's selection survives the click.
 */
@Component({
  selector: 'div[color-palette]',
  imports: [MatIconModule],
  templateUrl: './color-palette.html',
  styleUrl: './color-palette.scss',
  host: {
    role: 'listbox',
    '(mousedown)': '$event.preventDefault()',
  },
})
export class ColorPalette {
  readonly colors = input.required<readonly { name: string; value: string }[]>();
  /** The first swatch, which takes the colour off: "Automatic", "None". */
  readonly resetLabel = input.required<string>();

  /** A swatch was picked: its value, or null for the reset swatch. */
  readonly picked = output<string | null>();
}
