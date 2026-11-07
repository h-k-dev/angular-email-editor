import { Component, input } from '@angular/core';

// Angular Material
import { MatIcon } from '@angular/material/icon';

/**
 * A sticker: one Material Symbol on a round disc, the surface's inks
 * swapped — the surface's ink for the disc, the surface for the glyph and
 * a ring round it — over a hard primary shadow, offset down and to the
 * inline end, no blur. A dialog's hero icon, an empty state's picture.
 *
 *     <sticker-icon icon="note_stack_add" />
 *     <sticker-icon icon="inbox" style="--sticker-size: 96px" />
 *
 * `--sticker-size` is its width (64px); the glyph, the ring and the
 * shadow's offset scale with it. Decoration: whatever it stands beside
 * says what it means.
 */
@Component({
  selector: 'sticker-icon',
  imports: [MatIcon],
  template: '<mat-icon>{{ icon() }}</mat-icon>',
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      --_size: var(--sticker-size, 64px);
      --_ring: calc(var(--_size) / 32);
      --_offset: calc(var(--_size) / 16);
      --_offset-x: var(--_offset);
      display: inline-grid;
      flex: none;
      place-items: center;
      inline-size: var(--_size);
      block-size: var(--_size);
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-on-surface);
      color: var(--mat-sys-surface);
      box-shadow:
        0 0 0 var(--_ring) var(--mat-sys-surface),
        var(--_offset-x) var(--_offset) 0 var(--_ring) var(--mat-sys-primary);
    }

    // The shadow falls to the inline end: left in a right-to-left page.
    :host(:dir(rtl)) {
      --_offset-x: calc(var(--_offset) * -1);
    }

    // The glyph at 9/16 of the disc: 36px on the 64px default.
    mat-icon {
      --mat-icon-size: calc(var(--_size) * 0.5625);
    }
  `,
})
export class StickerIcon {
  /** The Material Symbol's name. */
  readonly icon = input.required<string>();
}
