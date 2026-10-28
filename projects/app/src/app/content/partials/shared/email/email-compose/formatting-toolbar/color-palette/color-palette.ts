import { Component, computed, input, output, signal } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';

import { CustomColor } from '../../custom-color/custom-color';
import { injectSwatchPaint } from '../../../swatch-paint';

/**
 * A curated swatch picker: the text palette (every swatch reads at AA on
 * white and once a client inverts it) or the background one (pale tints
 * that keep text readable either way), the user's custom swatches after
 * them — each shown as it looks on the paper, drawn by Dawn on a dark one. A host names its custom row
 * (`customLabel`: "Custom text color…", "Custom background color…"): the
 * grid's last row, in words, opening our own picker in its place
 * (`CustomColor`: shade, hue, hex) and
 * wearing the colour in effect when it is none of the swatches. A colour
 * picked there is the host's to remember (`noteCustomColor`), as a swatch.
 *
 * The host names the palette (`aria-label` / `aria-labelledby`) and draws
 * the surface it sits on. A mousedown never takes focus, so the editor's
 * selection survives the click.
 */
@Component({
  selector: 'div[color-palette]',
  imports: [CustomColor, MatIconModule],
  templateUrl: './color-palette.html',
  styleUrl: './color-palette.scss',
  hostDirectives: [KeepFocus],
  host: { role: 'listbox' },
})
export class ColorPalette {
  readonly colors = input.required<readonly { name: string; value: string }[]>();
  /** The first swatch, which takes the colour off: "Automatic", "None". */
  readonly resetLabel = input.required<string>();
  /** The colour in effect, marked as selected — null marks the reset swatch. */
  readonly value = input<string | null>(null);

  /** The custom row's words — "Custom text color…" — or null for none:
      only the swatches are offered. */
  readonly customLabel = input<string | null>(null);

  /** A swatch was picked: its value, or null for the reset swatch. A
      custom colour arrives as `#rrggbb` once the picker's Apply takes it
      (never a step of a drag: one colour, one undo step). */
  readonly picked = output<string | null>();

  /** Each swatch as it looks on the paper — drawn by Dawn on a dark one —
      its value still the colour a pick applies. */
  readonly #paint = injectSwatchPaint();
  protected readonly swatches = computed(() => {
    const paint = this.#paint();
    return this.colors().map((color) => ({ ...color, shown: paint(color.value) }));
  });

  /** The palette's own spelling of the colour in effect — the document may
      spell a hex value in either case. Null when no swatch is it. */
  protected readonly selected = computed(() => {
    const value = this.value()?.toLowerCase();
    return this.colors().find((color) => color.value.toLowerCase() === value)?.value ?? null;
  });

  /** The colour in effect when it is none of the palette's — the custom
      swatch wears it — else null. */
  protected readonly custom = computed(() =>
    this.value() !== null && this.selected() === null ? this.value() : null,
  );

  /** The custom colour in effect, as it looks on the paper. */
  protected readonly customShown = computed(() => {
    const custom = this.custom();
    return custom === null ? null : this.#paint()(custom);
  });

  /** Whether the custom row is open as the picker. */
  protected readonly editing = signal(false);

  protected pickCustom(color: string): void {
    this.editing.set(false);
    this.picked.emit(color);
  }
}
