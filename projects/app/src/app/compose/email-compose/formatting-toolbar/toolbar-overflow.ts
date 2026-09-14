import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  contentChildren,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

/**
 * A row of tools that stays one line: when it runs out of room, its tail
 * moves out — into a ⋯ menu the host renders from `overflowFrom`. Measured,
 * never guessed: whatever the width, the items keep their order and the
 * tail is what moves.
 *
 * Every item keeps its box whether it shows or has moved (the host styles
 * `[data-overflow]` items `visibility: hidden` and the row `overflow:
 * hidden`, its items `flex: none`), so each right edge is where it would
 * be — no re-layout to measure, and no loop between measuring and moving.
 */
@Directive({
  selector: '[toolbarOverflow]',
  exportAs: 'toolbarOverflow',
})
export class ToolbarOverflow {
  readonly #row = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Whether the row gives way at all. Off (a phone, where the row scrolls
      instead) nothing moves. */
  readonly enabled = input(true, { alias: 'toolbarOverflow' });

  /** The ⋯ that holds what moved — a sibling after the row, shown only once
      something has. Its room comes out of the row, and is counted back, so
      showing it never moves the line. */
  readonly more = input<Element | undefined>(undefined, { alias: 'toolbarOverflowMore' });

  /** The items that give way, in row order; anything else in the row (a
      dropdown before them, a divider) stays. */
  readonly items = contentChildren(ToolbarOverflowItem, { descendants: true });

  readonly #from = signal<number | null>(null);

  /** The index in `items` of the first item that no longer fits, or null
      when all of them do. */
  readonly overflowFrom = computed(() => (this.enabled() ? this.#from() : null));

  /** Whether the item at an index has moved out of the row. */
  movedAt(index: number): boolean {
    const from = this.overflowFrom();
    return from !== null && index >= from;
  }

  constructor() {
    // The row's width changes with the pane, with the toolbar shown again,
    // with the ⋯ coming and going (counted back, so a no-op) and across the
    // breakpoint, where the tools change size.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.#measure());
      observer.observe(this.#row);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    // …and whenever it is switched on, or its items change. Measuring is
    // layout reading, so the read phase: after every write of the pass (a
    // field taking focus), one layout for all of them. The signal it sets
    // renders on the next pass, which is a write in its own right.
    afterRenderEffect({
      read: () => {
        this.enabled();
        this.items();
        untracked(() => this.#measure());
      },
    });
  }

  #measure(): void {
    if (!this.enabled()) {
      this.#from.set(null);
      return;
    }
    // Hidden (display: none) has no line to measure: keep the last one, so
    // showing the row again paints it right the first time.
    if (!this.#row.offsetWidth) return;

    const items = this.items().map((item) => item.element);
    const last = items.at(-1);
    if (!last) {
      this.#from.set(null);
      return;
    }
    const gap = parseFloat(getComputedStyle(this.#row.parentElement ?? this.#row).columnGap) || 0;
    const more = this.more() as HTMLElement | undefined;
    // What the ⋯ takes from the row while it shows (0 hidden: display none).
    const moreShown = more?.offsetWidth ? more.offsetWidth + gap : 0;
    const rowEnd =
      this.#row.getBoundingClientRect().right -
      (parseFloat(getComputedStyle(this.#row).paddingRight) || 0) +
      moreShown;
    const right = (el: HTMLElement) => el.getBoundingClientRect().right;
    if (right(last) <= rowEnd + 0.5) {
      this.#from.set(null);
      return;
    }
    // Room for the ⋯ once anything moves. Hidden, it has no width to read —
    // it is a tool like the items, so the last one's stands in.
    const reserve = (more?.offsetWidth || last.offsetWidth) + gap;
    const from = items.findIndex((el) => right(el) > rowEnd - reserve + 0.5);
    this.#from.set(from < 0 ? null : from);
  }
}

/** An item of a `toolbarOverflow` row: reflects `data-overflow` once it has
    moved into the ⋯ menu. */
@Directive({
  selector: '[toolbarOverflowItem]',
  exportAs: 'toolbarOverflowItem',
  host: { '[attr.data-overflow]': 'moved() || null' },
})
export class ToolbarOverflowItem {
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #overflow = inject(ToolbarOverflow);

  readonly moved = computed(() => this.#overflow.movedAt(this.#overflow.items().indexOf(this)));
}
