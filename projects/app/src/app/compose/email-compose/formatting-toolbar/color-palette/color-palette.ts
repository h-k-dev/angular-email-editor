import { Component, computed, input, output } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';

/**
 * A curated swatch picker: the text palette (dual-contrast — every swatch
 * reads on both white and near-black, so it survives forced dark-mode
 * inversion) or the background one (pale tints that keep text readable
 * either way). No hex input: arbitrary colours live solely in the HTML
 * source, on purpose.
 *
 * The host names the palette (`aria-label` / `aria-labelledby`) and draws
 * the surface it sits on. A mousedown never takes focus, so the editor's
 * selection survives the click.
 */
@Component({
  selector: 'div[color-palette]',
  imports: [MatIconModule],
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

  /** A swatch was picked: its value, or null for the reset swatch. */
  readonly picked = output<string | null>();

  /** The palette's own spelling of the colour in effect — the document may
      spell a hex value in either case. Null when no swatch is it. */
  protected readonly selected = computed(() => {
    const value = this.value()?.toLowerCase();
    return this.colors().find((color) => color.value.toLowerCase() === value)?.value ?? null;
  });
}
