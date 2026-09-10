import { Component, input } from '@angular/core';

/** The trade a hint pictures: a message file becoming the page, a file
    becoming an attachment, an image going into the text. */
export type DropHintArt = 'import' | 'attach' | 'inline';

/**
 * What a dropzone says while a file hangs over it: what will happen if it
 * is let go here, and where to go for the other thing.
 *
 * Three zones nest on the page (compose.html) — the page imports, the writer
 * attaches, the editing surface embeds images — and a drop's meaning turns
 * on where the pointer is when it opens. That has to be said out loud at the
 * moment of the drop, not learned: a picture of the trade and a line naming
 * it, plus the escape ("to attach instead, drop it on the message").
 *
 * Purely presentational. It never sees a file, never listens for a drag —
 * the zone around it owns all of that and hands the answer down as `active`.
 * Click-through, so it can cover a zone without taking a drop from it. Its
 * host must be positioned: the hint fills it.
 */
@Component({
  selector: '[drop-hint]',
  templateUrl: './drop-hint.html',
  styleUrl: './drop-hint.scss',
  host: {
    '[class.is-active]': 'active()',
    '[attr.aria-hidden]': 'true',
  },
})
export class DropHint {
  /** True while a file is over the zone. Off, nothing is rendered — a
      permanent placard is clutter, and the rule only needs explaining while
      it is being used. */
  readonly active = input(false);
  /** The picture of the trade. */
  readonly art = input.required<DropHintArt>();
  /** One line naming the outcome: "Drop to …". */
  readonly heading = input.required<string>();
  /** The rest: what happens, and where to drop for the other thing. */
  readonly text = input.required<string>();
}
