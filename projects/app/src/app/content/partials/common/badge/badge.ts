import { Component, input } from '@angular/core';

/** How a badge stands out: quietly on the surface, in the theme's colour,
    or dark over a picture (a thumbnail's corner, YouTube's length). */
export type BadgeTone = 'neutral' | 'primary' | 'overlay';

/**
 * A badge: a few words — a category, a state, a count — in a small pill
 * beside what it describes. One line, never wrapping; the text is the
 * host's.
 *
 *     <span badge>AngularJS</span>
 *     <span badge tone="overlay">Handlebars</span>
 *
 * Neutral by default: the surface a step up, its quiet ink. `primary` for
 * what should be seen; `overlay` over a picture, light on a dark veil that
 * reads on any image, light or dark theme alike.
 */
@Component({
  selector: '[badge]',
  template: '<ng-content />',
  host: { '[attr.data-tone]': 'tone()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      box-sizing: border-box;
      block-size: 20px;
      padding-inline: 8px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    :host([data-tone='primary']) {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    :host([data-tone='overlay']) {
      background: rgb(0 0 0 / 0.6);
      color: #ffffff;
    }
  `,
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
}
