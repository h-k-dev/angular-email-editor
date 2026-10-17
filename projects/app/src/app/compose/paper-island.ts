import { Directive, Signal, computed, inject, input } from '@angular/core';

import { EditorColorScheme } from './email-compose/email-compose';

/**
 * A paper island: one region of the app — however deep, whatever it holds —
 * that wears the editor's paper, light or dark, instead of the app's theme,
 * so everything in it reads as one document (the zoomed compose window:
 * title bar, writer bar, envelope rows and text on one sheet).
 *
 * The island is an agreement in two halves, so no part inside has to be
 * told it is on one:
 *
 * - **CSS**, for everything in the island's DOM. The island carries
 *   `data-paper-scheme`; the global rule (styles.scss) sets `color-scheme`
 *   there, so every --mat-sys-* token — a light-dark() pair — re-resolves
 *   for the whole subtree, and defines `--email-paper`, the paper's colour.
 *   A part that should BE the paper rather than the app's surface reads it
 *   with a fallback, `var(--email-paper, <its own>)`; off an island the
 *   fallback is all it ever sees.
 * - **DI**, for what the island owns but the DOM puts elsewhere. An overlay
 *   opened from inside renders in the CDK overlay container on <body>, out
 *   of reach of the island's CSS — but its injector is still the island's.
 *   {@link PaperIslandScheme} on the overlay's root carries the scheme
 *   across.
 *
 * Anything can be an island: an element in a template, with
 * {@link PaperIslandDirective} (`[paperIsland]="scheme"`), or a component
 * that provides `PaperIsland` itself and sets the attribute on its host —
 * the compose window does, its scheme being its sheet's while zoomed. A
 * `null` scheme is no island: the app's theme, and every consumer falls
 * back.
 */
export abstract class PaperIsland {
  /** The island's paper, or `null` — no island here. */
  abstract readonly scheme: Signal<EditorColorScheme | null>;
}

/** An island on any element: `[paperIsland]="'dark'"`. */
@Directive({
  selector: '[paperIsland]',
  providers: [{ provide: PaperIsland, useExisting: PaperIslandDirective }],
  host: { '[attr.data-paper-scheme]': 'scheme()' },
})
export class PaperIslandDirective implements PaperIsland {
  readonly scheme = input<EditorColorScheme | null>(null, { alias: 'paperIsland' });
}

/**
 * The island's scheme on an element rendered outside it — an overlay's
 * root: a menu, a popover, a picker opened from inside the island. Reads the
 * nearest island through DI, so off an island it sets nothing and the
 * overlay keeps the app's theme.
 */
@Directive({
  selector: '[paperIslandScheme]',
  host: { '[attr.data-paper-scheme]': 'scheme()' },
})
export class PaperIslandScheme {
  readonly #island = inject(PaperIsland, { optional: true });
  protected readonly scheme = computed(() => this.#island?.scheme() ?? null);
}
