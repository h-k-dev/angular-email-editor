import { Component, computed, input, output } from '@angular/core';

// Material
import { MatIconModule } from '@angular/material/icon';
import { KeepFocus } from '@h-k-dev/angular-email-editor/focus';

/**
 * A curated swatch picker: the text palette (every swatch reads at AA on
 * white and once a client inverts it, and carries a dark variant for the
 * clients that read the email's dark-mode styles) or the background one
 * (pale tints that keep text readable either way, each with its dark tint). No hex input by default: arbitrary colours live in the HTML
 * source, on purpose. A host that wants one anyway — a page's colour, which
 * holds no text of its own to lose — names it (`customLabel`): a last swatch
 * then opens the platform's colour picker, and wears the colour in effect
 * when it is none of the palette's. Such a colour has no dark variant.
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

  /** The custom swatch's name — "Custom colour…" — or null for none:
      only the palette's colours are offered. */
  readonly customLabel = input<string | null>(null);

  /** A swatch was picked: its value, or null for the reset swatch. A
      custom colour arrives as `#rrggbb`, live while the picker moves. */
  readonly picked = output<string | null>();

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

  /** Opens the platform's picker, anchored on the swatch (the input sits
      under it, unseen). */
  protected openPicker(picker: HTMLInputElement): void {
    try {
      picker.showPicker();
    } catch {
      picker.click();
    }
  }

  protected pickCustom(picker: HTMLInputElement): void {
    this.picked.emit(picker.value.toLowerCase());
  }
}
