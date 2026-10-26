import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Signal,
  TemplateRef,
  ViewContainerRef,
  ViewEncapsulation,
  afterNextRender,
  afterRenderEffect,
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

import { ScrollOwner } from '../../../../core/directives/scroll-owner/scroll-owner';

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

/** What a cell's template is handed: the item, and its place in the list. */
export interface VirtualGridItemContext<T> {
  $implicit: T;
  index: number;
}

/** A cell of the grid, its template written as a `@for` would be:
    `<template-card *virtualGridItem="let card of cards()" [card]="card" />` —
    the items, each with an `id` to track it by. */
@Directive({ selector: '[virtualGridItem][virtualGridItemOf]' })
export class VirtualGridItem<T extends { readonly id: string | number }> {
  readonly of = input.required<readonly T[]>({ alias: 'virtualGridItemOf' });
  readonly template = inject<TemplateRef<VirtualGridItemContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T extends { readonly id: string | number }>(
    _cell: VirtualGridItem<T>,
    context: unknown,
  ): context is VirtualGridItemContext<T> {
    return true;
  }
}

/** What a place still on its way is drawn as, instead of the grid's own
    skeleton — the card's shape, empty: `<ng-template virtualGridPlaceholder>`.
    As tall as a card, so a page landing moves nothing. */
@Directive({ selector: 'ng-template[virtualGridPlaceholder]' })
export class VirtualGridPlaceholder {
  readonly template = inject(TemplateRef);
}

/** A place in the drawn rows: an item, or — `item` undefined — one on its
    way, drawn as a placeholder. */
interface VirtualGridSlot<T> {
  readonly index: number;
  readonly key: string | number;
  readonly item: T | undefined;
  /** The colour its hover and press are washed in; null for the neutral. */
  readonly tint: string | null;
}

/**
 * A grid that draws only the rows in view, YouTube's home feed: as many
 * columns of at least `min` px as the width holds (`maxColumns` at the
 * most, each `max` px at the widest — the rows centre past it), rows of one
 * height (the first drawn row's, measured), and the cells of the rows on
 * screen — `overscan` rows more on each side — moved down into place under
 * a box as tall as every row would be. It scrolls with what scrolls it —
 * the `[scrollOwner]` round it, else its nearest scrolling ancestor, else
 * the page — never in a box of its own.
 *
 *     <virtual-grid (endReached)="more()">
 *       <template-card *virtualGridItem="let card of cards()" [card]="card" />
 *     </virtual-grid>
 *
 * Two ways to load, one or both:
 * - A feed: `endReached` is asked whenever the last item come is near —
 *   the first page included, while there are no items yet. Whoever answers
 *   knows whether there is more.
 * - A known length: `total` says how many there are, the places past the
 *   items come are drawn as placeholders (`virtualGridPlaceholder`, or the
 *   grid's skeleton), and `demand` says how many items the drawn rows want —
 *   a scrollbar dragged half way down asks for that half, not the next page.
 *
 * The press and hover are the grid's, not the card's: YouTube's touch
 * feedback shape, a wash reaching `--virtual-grid-reach` (12px) past the
 * card, growing into place on hover and deepening on the press — neutral,
 * or each item's own colour (`tint`). The card marks its press, the one
 * button that opens it, `data-grid-press`: its hit area becomes the whole
 * wash, its focus rings it. Nothing between that button and the cell may
 * be positioned. The grid's look is its stylesheet's (virtual-grid.scss):
 * `--virtual-grid-corner`, `-reach`, `-hover-color`, `-press-color`, and
 * for its skeleton `-media-aspect` and `-meta-size`.
 *
 * A `list` (`label` names it), every item a `listitem` with its place —
 * "3 of 120" — though only a screenful exists; placeholders are hidden.
 * The grid is an island ({@link GridIsland}): a cell's heavy part waits
 * under `*gridSeen` until the cell is really looked at.
 */
@Component({
  selector: 'virtual-grid',
  imports: [NgTemplateOutlet],
  templateUrl: './virtual-grid.html',
  styleUrl: './virtual-grid.scss',
  // The press a card marks (`data-grid-press`) is in the card's template,
  // not this one: the stylesheet reaches it by its classes, unscoped.
  encapsulation: ViewEncapsulation.None,
  providers: [{ provide: GridIsland, useExisting: VirtualGrid }],
  host: {
    class: 'virtual-grid',
    role: 'list',
    '[attr.aria-label]': 'label() || null',
    '[style.block-size.px]': 'height()',
    '[style.--grid-columns]': 'columns()',
    '[style.--grid-column-width.px]': 'columnWidth()',
    '[style.--grid-column-max]': "max() === null ? '1fr' : max() + 'px'",
    '[style.--grid-gap.px]': 'gap()',
    '[style.--grid-row-gap.px]': 'rowGap()',
  },
})
export class VirtualGrid<T extends { readonly id: string | number }> implements GridIsland {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #owner = inject(ScrollOwner, { optional: true });

  /** A column's least width, px. */
  readonly min = input(280);
  /** A column's widest, px; past it the rows centre. Null: as wide as the
      width shares out. */
  readonly max = input<number | null>(null);
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
  /** How many there are in all, the items not come yet drawn as
      placeholders; unknown, only the items come. */
  readonly total = input<number | undefined>(undefined);
  /** An item's own colour for its hover and press (any CSS colour, washed
      in at YouTube's 17%); null for the neutral. */
  readonly tint = input<((item: T) => string | null) | null>(null);
  /** Names the list. */
  readonly label = input<string>();

  /** The last row come is near: time for the next page. */
  readonly endReached = output<void>();

  protected readonly cell = contentChild(VirtualGridItem<T>);
  protected readonly placeholder = contentChild(VirtualGridPlaceholder);
  readonly #items = computed<readonly T[]>(() => this.cell()?.of() ?? []);

  /** Every place: the items come, and the rest of `total`. */
  protected readonly count = computed(() => Math.max(this.total() ?? 0, this.#items().length));

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
    const shared = Math.max(0, (this.#width() - this.gap() * (columns - 1)) / columns);
    const max = this.max();
    return max === null ? shared : Math.min(shared, max);
  });

  readonly #rows = computed(() => Math.ceil(this.count() / this.columns()));
  readonly #stride = computed(() => this.#measured() || this.estimate() + this.rowGap());

  /** The last row the view and its overscan reach, whether it exists or not. */
  readonly #reach = computed(
    () => Math.ceil((this.#top() + this.#viewport()) / this.#stride()) + this.overscan(),
  );

  /** The rows drawn: `first` to `last`, the last not included. */
  readonly #range = computed(() => {
    const rows = this.#rows();
    const clamp = (row: number) => Math.max(0, Math.min(rows, row));
    return {
      first: clamp(Math.floor(this.#top() / this.#stride()) - this.overscan()),
      last: clamp(this.#reach()),
    };
  });

  /** How many items the drawn rows want: every place up to the last of
      them — 0 until the grid is measured. Whoever loads reads it and loads
      until the items cover it. */
  readonly demand = computed(() => {
    if (!this.#width()) return 0;
    const wanted = this.#reach() * this.columns();
    const total = this.total();
    return total === undefined ? wanted : Math.min(total, wanted);
  });

  protected readonly shown = computed<readonly VirtualGridSlot<T>[]>(() => {
    const { first, last } = this.#range();
    const columns = this.columns();
    const items = this.#items();
    const tint = this.tint();
    const slots: VirtualGridSlot<T>[] = [];
    for (let index = first * columns; index < Math.min(last * columns, this.count()); index++) {
      const item = items[index];
      slots.push(
        item === undefined
          ? { index, key: `placeholder-${index}`, item, tint: null }
          : { index, key: item.id, item, tint: tint?.(item) ?? null },
      );
    }
    return slots;
  });

  protected readonly shift = computed(() => `0 ${this.#range().first * this.#stride()}px`);

  protected readonly height = computed(() =>
    Math.max(0, this.#rows() * this.#stride() - this.rowGap()),
  );

  private readonly drawn = viewChild.required<ElementRef<HTMLElement>>('drawn');

  /** What the grid scrolls with, while it is tracked. */
  #scroller: HTMLElement | null = null;

  constructor() {
    // Tracked again whenever the owner round it takes the scroll or gives
    // it up — a sheet that scrolls on a desk, a page that does on a phone.
    afterRenderEffect((onCleanup) => {
      this.#owner?.active();
      onCleanup(untracked(() => this.#track()));
    });

    // The end come in view — the items changing under it too (a page in, a
    // filter out): ask for more, unless every place has come.
    effect(() => {
      const items = this.#items().length;
      const total = this.total();
      if (!this.#width() || (total !== undefined && items >= total)) return;
      const near = this.#range().last >= Math.ceil(items / this.columns()) - this.overscan();
      if (near) untracked(() => this.endReached.emit());
    });

    inject(DestroyRef).onDestroy(() => this.#seen?.disconnect());
  }

  /** Back to the first row — the list replaced under it (a new search, a
      new item on top): the grid's top to the view's, if it was above it. */
  scrollToStart(): void {
    const scroller = this.#scroller;
    if (!scroller) return;
    const above = this.#viewTop(scroller) - this.#host.getBoundingClientRect().top;
    if (above > 0) scroller.scrollBy({ top: -above, behavior: 'instant' });
  }

  /** What scrolls the grid: the owner round it while it owns the scroll,
      else the nearest ancestor that scrolls, else the page. */
  #scrollerOf(): HTMLElement {
    const owner = this.#owner;
    if (owner?.active()) return owner.element;
    const document = this.#host.ownerDocument;
    const view = document.defaultView!;
    for (let node = this.#host.parentElement; node; node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      if (/auto|scroll|overlay/.test(view.getComputedStyle(node).overflowY)) return node;
    }
    return document.scrollingElement as HTMLElement;
  }

  /** The view's top on the screen: the page's, or the scroller's. */
  #viewTop(scroller: HTMLElement): number {
    return scroller === scroller.ownerDocument.scrollingElement
      ? 0
      : scroller.getBoundingClientRect().top;
  }

  /** Follows the scroll and the grid's size; measures the rows as they are
      drawn. Returns the release. */
  #track(): () => void {
    const scroller = (this.#scroller = this.#scrollerOf());
    const page = scroller === scroller.ownerDocument.scrollingElement;
    const view = scroller.ownerDocument.defaultView!;
    const target: EventTarget = page ? view : scroller;
    const drawn = this.drawn().nativeElement;

    let frame = 0;
    const measure = () => {
      frame = 0;
      this.#top.set(this.#viewTop(scroller) - this.#host.getBoundingClientRect().top);
      this.#viewport.set(page ? view.innerHeight : scroller.clientHeight);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(measure));
    target.addEventListener('scroll', onScroll, { passive: true });
    view.addEventListener('resize', onScroll, { passive: true });
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

    // The cells waiting to be seen, watched from the new scroller.
    this.#seen?.disconnect();
    this.#seen = null;
    if (this.#waiting.size) {
      const observer = this.#observer();
      for (const element of this.#waiting.keys()) observer.observe(element);
    }

    return () => {
      target.removeEventListener('scroll', onScroll);
      view.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      sizes.disconnect();
    };
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

  /** The one observer, on the grid's scroller — a little ahead of the view,
      so what comes in is drawn as it arrives. */
  #observer(): IntersectionObserver {
    if (this.#seen) return this.#seen;
    const scroller = this.#scroller ?? this.#scrollerOf();
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
