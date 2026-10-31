import { Component, input } from '@angular/core';

/** How a glass group is finished (`glassGroup`). */
export type GlassGroupVariant = 'glass' | 'outline';

/**
 * A group of buttons on glass — a module of macOS's Control Center: one
 * capsule of frosted surface the buttons sit in, the page blurred through
 * it, a hairline round it and light catching its top edge. Toggles of a
 * kind stand together in one (the designer's: the panes beside the canvas;
 * how the email is worked on), so a bar reads as a few modules rather than
 * a row of loose icons.
 *
 *     <div glassGroup [attr.aria-label]="'designer.panes' | translate">
 *       <button matIconButton …>phone</button>
 *       <button matIconButton …>details</button>
 *     </div>
 *
 * Finished as `glass` (the bare attribute) or as its `outline` alone — the
 * same capsule, its edge and light without the fill: for a button that
 * stands by itself beside the modules, so it is drawn of a piece with them
 * without weighing as one (`<span glassGroup="outline">`).
 *
 * The capsule only: it projects its buttons as they are, draws the glass
 * on its own host (its look ships with it, in the chunk of the view that
 * uses it) and names itself a group for assistive tech; the host gives the
 * group its name. What the buttons look like — pressed, hovered — stays
 * theirs.
 */
@Component({
  selector: 'div[glassGroup], span[glassGroup]',
  template: '<ng-content />',
  styleUrl: './glass-group.scss',
  host: { role: 'group', '[attr.data-variant]': 'variant()' },
})
export class GlassGroup {
  /** The finish: `glass`, or its `outline` alone. */
  readonly variant = input<GlassGroupVariant, GlassGroupVariant | ''>('glass', {
    alias: 'glassGroup',
    // The bare attribute (`<div glassGroup>`) is glass.
    transform: (value) => value || 'glass',
  });
}
