import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Signal,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { PageScroller } from '../../../../core/router/page-scroller';

/** How long a cell stays in view before what `*gridSeen` holds is drawn,
    ms: a cell flung past on a fast scroll never draws its heavy part. */
const SETTLE = 120;

/**
 * The grid as a data island: what every cell needs to know about the grid
 * it is in, relayed by DI (and as CSS variables on the grid's host —
 * `--grid-columns`, `--grid-column-width`), so no cell measures itself.
 */
export abstract class GridIsland {
  /** One column's width, px — a cell's own. */
  abstract readonly columnWidth: Signal<number>;
  /** Calls `then` once `element` has come into the page's view and stayed
      there a moment ({@link SETTLE}); returns the release, for a cell that
      goes before it was seen. One observer for the whole grid. */
  abstract seen(element: Element, then: () => void): () => void;
}

/** A cell of the grid, its template written as a `@for` would be:
    `<template-card *virtualGridItem="let card of cards()" [card]="card" />` —
    the items, each with an `id` to track it by. */
@Directive({ selector: '[virtualGridItem][virtualGridItemOf]' })
export class VirtualGridItem<T extends { readonly id: string }> {
  readonly of = input.required<readonly T[]>({ alias: 'virtualGridItemOf' });
  readonly template = inject<TemplateRef<{ $implicit: T }>>(TemplateRef);

  static ngTemplateContextGuard<T extends { readonly id: string }>(
    _cell: VirtualGridItem<T>,
    context: unknown,
  ): context is { $implicit: T } {
    return true;
  }
}

/**
 * A grid that draws only the rows in view, YouTube's home feed: as many
 * columns of at least `min` px as the width holds, rows of one height (the
 * first drawn row's, measured), and the cells of the rows on screen —
 * `overscan` rows more on each side — moved down into place under a box as
 * tall as every row would be. It scrolls with the page (`PageScroller`),
 * never in a box of its own.
 *
 *     <virtual-grid (endReached)="more()">
 *       <template-card *virtualGridItem="let card of cards()" [card]="card" />
 *     </virtual-grid>
 *
 * `endReached` is asked whenever the last row comes near — the first page
 * included, while there are no items yet: the feed's continuation. The
 * grid is an island ({@link GridIsland}): a cell's heavy part waits under
 * `*gridSeen` until the cell is really looked at.
 */
@Component({
  selector: 'virtual-grid',
  imports: [NgTemplateOutlet],
  template: `
    <div #drawn class="virtual-grid__window" [style.translate]="shift()">
      @if (cell(); as cell) {
        @for (item of shown(); track item.id) {
          <ng-container
            [ngTemplateOutlet]="cell.template"
            [ngTemplateOutletContext]="{ $implicit: item }"
          />
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }

    .virtual-grid__window {
      position: absolute;
      inset-block-start: 0;
      inset-inline: 0;
      display: grid;
      grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
      column-gap: var(--grid-gap);
      row-gap: var(--grid-row-gap);
    }
  `,
  providers: [{ provide: GridIsland, useExisting: VirtualGrid }],
  host: {
    '[style.block-size.px]': 'height()',
    '[style.--grid-columns]': 'columns()',
    '[style.--grid-column-width.px]': 'columnWidth()',
    '[style.--grid-gap.px]': 'gap()',
    '[style.--grid-row-gap.px]': 'rowGap()',
  },
})
export class VirtualGrid<T extends { readonly id: string }> implements GridIsland {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #pageScroller = inject(PageScroller);

  /** A column's least width, px. */
  readonly min = input(280);
  /** Never more columns than this, however wide. */
  readonly maxColumns = input(5);
  /** Between two columns, px. */
  readonly gap = input(16);
  /** Between two rows, px. */
  readonly rowGap = input(40);
  /** A row's height until one is drawn and measured, px. */
  readonly estimate = input(320);
  /** Rows drawn beyond the view, on each side. */
  readonly overscan = input(2);

  /** The last row is near: time for the next page. */
  readonly endReached = output<void>();

  protected readonly cell = contentChild(VirtualGridItem<T>);
  readonly #items = computed<readonly T[]>(() => this.cell()?.of() ?? []);

  /** The grid's width, the view's height, and how far the view's top is
      down the grid (negative while the grid starts below it), px. */
  readonly #width = signal(0);
  readonly #viewport = signal(0);
  readonly #top = signal(0);
  /** A row's height and the gap under it, as drawn — 0 until measured. */
  readonly #measured = signal(0);

  readonly columns = computed(() => {
    const width = this.#width();
    const gap = this.gap();
    const fit = Math.floor((width + gap) / (this.min() + gap));
    return Math.max(1, Math.min(this.maxColumns(), fit));
  });

  readonly columnWidth = computed(() => {
    const columns = this.columns();
    return Math.max(0, (this.#width() - this.gap() * (columns - 1)) / columns);
  });

  readonly #rows = computed(() => Math.ceil(this.#items().length / this.columns()));
  readonly #stride = computed(() => this.#measured() || this.estimate() + this.rowGap());

  /** The rows drawn: `first` to `last`, the last not included. */
  readonly #range = computed(() => {
    const stride = this.#stride();
    const rows = this.#rows();
    const overscan = this.overscan();
    const clamp = (row: number) => Math.max(0, Math.min(rows, row));
    return {
      first: clamp(Math.floor(this.#top() / stride) - overscan),
      last: clamp(Math.ceil((this.#top() + this.#viewport()) / stride) + overscan),
    };
  });

  protected readonly shown = computed(() => {
    const { first, last } = this.#range();
    const columns = this.columns();
    return this.#items().slice(first * columns, last * columns);
  });

  protected readonly shift = computed(() => `0 ${this.#range().first * this.#stride()}px`);

  protected readonly height = computed(() =>
    Math.max(0, this.#rows() * this.#stride() - this.rowGap()),
  );

  readonly #destroy = inject(DestroyRef);
  private readonly drawn = viewChild.required<ElementRef<HTMLElement>>('drawn');

  constructor() {
    afterNextRender(() => this.#track());

    // The end in view — the items changing under it too (a page in, a
    // filter out): ask for more. Whoever answers knows whether there is.
    effect(() => {
      this.#items();
      const near = this.#width() > 0 && this.#range().last >= this.#rows() - this.overscan();
      if (near) untracked(() => this.endReached.emit());
    });
  }

  /** Follows the page's scroll and the grid's size; measures the rows as
      they are drawn. */
  #track(): void {
    const scroller = this.#pageScroller.scroller;
    const page = scroller === scroller.ownerDocument.scrollingElement;
    const view = scroller.ownerDocument.defaultView!;
    const target: EventTarget = page ? view : scroller;
    const drawn = this.drawn().nativeElement;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewTop = page ? 0 : scroller.getBoundingClientRect().top;
      this.#top.set(viewTop - this.#host.getBoundingClientRect().top);
      this.#viewport.set(page ? view.innerHeight : scroller.clientHeight);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(measure));
    target.addEventListener('scroll', onScroll, { passive: true });
    measure();

    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this.#host) this.#width.set(entry.contentRect.width);
        else if (entry.target === drawn) {
          // A row as the page drew it — its first cell, stretched to the
          // row — not the drawn rows counted: the signals may already be
          // a pass ahead of the DOM.
          const row = drawn.firstElementChild?.getBoundingClientRect().height;
          if (row) this.#measured.set(row + untracked(this.rowGap));
        }
      }
      onScroll();
    });
    sizes.observe(this.#host);
    sizes.observe(drawn);
    sizes.observe(scroller);

    this.#destroy.onDestroy(() => {
      target.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      sizes.disconnect();
      this.#seen?.disconnect();
    });
  }

  readonly #waiting = new Map<Element, { then: () => void; timer?: ReturnType<typeof setTimeout> }>();
  #seen: IntersectionObserver | null = null;

  seen(element: Element, then: () => void): () => void {
    const release = () => {
      clearTimeout(this.#waiting.get(element)?.timer);
      this.#waiting.delete(element);
      this.#seen?.unobserve(element);
    };
    this.#waiting.set(element, { then });
    this.#observer().observe(element);
    return release;
  }

  /** The one observer, on the page's scroller — a little ahead of the view,
      so what comes in is drawn as it arrives. */
  #observer(): IntersectionObserver {
    if (this.#seen) return this.#seen;
    const scroller = this.#pageScroller.scroller;
    const root = scroller === scroller.ownerDocument.scrollingElement ? null : scroller;
    return (this.#seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const waiting = this.#waiting.get(entry.target);
          if (!waiting) continue;
          if (!entry.isIntersecting) {
            clearTimeout(waiting.timer);
            waiting.timer = undefined;
          } else {
            waiting.timer ??= setTimeout(() => {
              this.#waiting.delete(entry.target);
              this.#seen?.unobserve(entry.target);
              waiting.then();
            }, SETTLE);
          }
        }
      },
      { root, rootMargin: '25% 0px' },
    ));
  }
}

/**
 * Draws what it holds once its cell has been seen in a grid ({@link
 * GridIsland}) — the cell's parent element, watched: a thumbnail, a frame,
 * whatever is too heavy for every row drawn ahead of the view. Off a grid
 * it draws at once.
 *
 *     <div class="card__thumb">
 *       <email-thumbnail *gridSeen [html]="card.html" />
 *     </div>
 */
@Directive({ selector: '[gridSeen]' })
export class GridSeen {
  constructor() {
    const view = inject(ViewContainerRef);
    const template = inject(TemplateRef);
    const island = inject(GridIsland, { optional: true });
    const anchor = inject<ElementRef<Comment>>(ElementRef).nativeElement;
    let release = () => {};
    afterNextRender(() => {
      // Drawn outside a change detection pass (the observer's timer): the
      // new view is checked here, and with its cell from then on.
      const draw = () => view.createEmbeddedView(template).detectChanges();
      const cell = anchor.parentElement;
      if (!island || !cell) return draw();
      release = island.seen(cell, draw);
    });
    inject(DestroyRef).onDestroy(() => release());
  }
}
