import { Component, booleanAttribute, input } from '@angular/core';

/**
 * Four dots and the shape round them, morphing between two figures: three
 * hollow dots in a row (⋯, the 4th folded into the middle one) on a lying
 * pill, and a filled 2×2 grid on a circle — for a toggle whose two
 * states are "one line" and "a grid": the attachment strip's one or two
 * rows. The shape is the button's look, so it is never a fixed circle round
 * a changing glyph: it flattens to the row and rounds out to the grid.
 *
 * All SVG, all CSS transitions: each dot placed by its transform alone, the
 * shape a `rect` whose geometry (`x`, `y`, `width`, `height`, `rx`) is CSS,
 * so it moves with them. Where a browser does not take SVG geometry from CSS
 * the shape stands as the circle its attributes draw, and only the dots move.
 * Still for whoever asked for less motion.
 *
 * Knobs: `--dots-morph-size` (the figure's box, default 20px),
 * `--dots-morph-surface` (the shape's fill, none by default),
 * `--dots-morph-shadow` (a `drop-shadow()` for it), `--dots-morph-ring`
 * (its outline, for a focus ring that follows the shape).
 *
 * Decorative: the button around it carries the name and `aria-pressed`.
 */
@Component({
  selector: 'dots-morph',
  template: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    <rect data-shape x="1" y="1" width="22" height="22" rx="11" ry="11" />
    @for (dot of dots; track $index) {
      <circle r="2.25" [attr.data-dot]="$index" />
    }
  </svg>`,
  styleUrl: './dots-morph.scss',
  host: { '[attr.data-grid]': "grid() ? '' : null" },
})
export class DotsMorph {
  /** The 2×2 grid on a circle; otherwise the hollow row on a pill. */
  readonly grid = input(false, { transform: booleanAttribute });

  protected readonly dots = [0, 1, 2, 3];
}
