import { Directive, computed, input } from '@angular/core';

import { hue } from '../../../../core/randomisation/hue';

/**
 * A container in a name's colour family: `--avatar-hue` on its host, the
 * name hashed round the wheel (`core/randomisation/hue.ts`) — one hue per
 * name, the same every time and everywhere it shows. An avatar inside
 * (`[avatar]`) takes it, and the host's own wash or lines take the colours
 * styles/_hue-of.scss derives from it (global, in styles.scss):
 *
 * - `--avatar-fill` — an avatar's face: white reads on it, a step darker
 *   on dark.
 * - `--avatar-tint` — the colour on the surface round it (a wash, a line):
 *   a step lighter on dark, so a line still shows there.
 *
 *     <li [hueOf]="sender.name">
 *       <span [avatar]="sender.name"></span> …
 *     </li>
 *     li:hover { background: color-mix(in oklch, var(--avatar-tint) 8%, transparent) }
 */
@Directive({
  selector: '[hueOf]',
  exportAs: 'hueOf',
  host: {
    class: 'hued',
    '[style.--avatar-hue]': 'hue()',
  },
})
export class HueOf {
  /** What the hue is of: a name, a key. */
  readonly hueOf = input.required<string>();

  /** 0–359. */
  readonly hue = computed(() => hue(this.hueOf()));
}

/** A name's `--avatar-tint` (styles/_hue-of.scss — keep the two in step), as
    a value: for a wash drawn where its container's custom properties do not
    reach, as a grid's cell round the card (`virtual-grid`'s `tint`). */
export function tintOf(name: string): string {
  const of = hue(name);
  return `light-dark(oklch(0.58 0.13 ${of}), oklch(0.74 0.11 ${of}))`;
}
