import { Directive, ElementRef, Signal, computed, inject, input } from '@angular/core';

// A type only: the composer imports this file for its island.
import type { EditorColorScheme } from './email-compose/email-compose';

/**
 * A paper island: one region of the app — however deep, whatever it holds —
 * that wears the editor's paper, light or dark, instead of the app's theme,
 * so everything in it reads as one document (every composer — a compose
 * window, the page's sheet: title bar, writer bar, envelope rows and text
 * on one sheet).
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
 *   across. And the island hands out its outermost element (`element`)
 *   for what must span all of it: the editor's block marquee is drawn there
 *   — it starts only in the editor's room, but its box follows the pointer
 *   over the whole island, title bar and envelope rows included, while it
 *   selects only the editor's blocks (Notion's). Its presses may start
 *   outside the editor too, wherever a {@link MarqueeStart} marks empty
 *   room — the island relays them (`marquee`).
 *
 * Anything can be an island: an element in a template, with
 * {@link PaperIslandDirective} (`[paperIsland]="scheme"`), or a component
 * that provides `PaperIsland` itself and sets the attribute on its host —
 * the compose window does — every window, its scheme being its sheet's;
 * the page puts the directive on its sheet. A `null` scheme keeps the app's theme (every consumer falls
 * back); the element is the island's all the same.
 */
export abstract class PaperIsland {
  /** The island's paper, or `null` — the app's theme. */
  abstract readonly scheme: Signal<EditorColorScheme | null>;
  /** The island's outermost element: what spans all of it draws here. */
  abstract readonly element: HTMLElement;
  /** The island's marquee, between the composer on it and its start points
      ({@link MarqueeStart}). */
  abstract readonly marquee: IslandMarquee;
}

/**
 * The go-between for the editor's block marquee on an island. The composer
 * on the island hands in how its editor starts the box (`register`); a start
 * point anywhere on the island — which cannot reach the composer, being its
 * neighbour or its ancestor, not its child — asks for it (`begin`). Neither
 * knows the other; both know the island.
 */
export class IslandMarquee {
  #begin: ((event: MouseEvent) => boolean) | null = null;

  /** The composer's start; returns its release, for when the composer goes. */
  register(begin: (event: MouseEvent) => boolean): () => void {
    this.#begin = begin;
    return () => {
      if (this.#begin === begin) this.#begin = null;
    };
  }

  /** A start point's press: whether the box started (and took the press). */
  begin(event: MouseEvent): boolean {
    return this.#begin?.(event) ?? false;
  }
}

/** An island on any element: `[paperIsland]="'dark'"`. */
@Directive({
  selector: '[paperIsland]',
  providers: [{ provide: PaperIsland, useExisting: PaperIslandDirective }],
  host: { '[attr.data-paper-scheme]': 'scheme()' },
})
export class PaperIslandDirective implements PaperIsland {
  readonly scheme = input<EditorColorScheme | null>(null, { alias: 'paperIsland' });
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly marquee = new IslandMarquee();
}

/**
 * A start point for the editor's block marquee, anywhere on its island: a
 * press on this element's own empty room — the element itself, never a child
 * (a label, a field, a button keep their presses) — starts the box, as a
 * press in the editor's margin does (Notion's page margins). Off an island,
 * or with no marquee editor on it, it does nothing. A press released in place
 * changes nothing (`beginBlockMarquee`).
 */
@Directive({
  selector: '[marqueeStart]',
  host: { '(mousedown)': 'press($event)' },
})
export class MarqueeStart {
  readonly #island = inject(PaperIsland, { optional: true });
  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected press(event: MouseEvent): void {
    if (event.target !== this.#element) return;
    this.#island?.marquee.begin(event);
  }
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
