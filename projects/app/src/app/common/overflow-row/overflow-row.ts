import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  inject,
  computed,

  // Signals
  input,
  signal,
  viewChild,
} from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

/** Roles a horizontally scrolling cluster plausibly carries, see `rowRole`. */
export type OverflowRowRole = 'group' | 'radiogroup' | 'toolbar' | 'tablist' | 'list';

/** How far a press travels before it is a drag and not a click, in px — a
    hand on a mouse wobbles a pixel or two while it clicks. */
const DRAG_SLOP = 4;

/**
 * One line that scrolls sideways instead of wrapping, with edge paddles —
 * core's `m-overflow-row` (partials/common/overflow-row), plus the mouse's
 * own way across: press anywhere on the row and drag, as on a touch screen.
 *
 * Project the items. This host owns the flex row, the hidden scrollbar, the
 * paddles and the drag; it does not own what the items are or how they
 * activate.
 *
 * ```html
 * <overflow-row rowRole="toolbar" [rowLabel]="label">
 *   <button type="button">…</button>
 * </overflow-row>
 * ```
 *
 * The flex row is a real element and cannot be projected away, so an ARIA
 * group lives on IT (`rowRole`) rather than on the consumer's host — that
 * keeps the projected items direct children of the group. Projecting a
 * container that is the group itself (a `ul`, a form control) needs no role
 * here.
 *
 * Paddles are a pointer affordance only (`aria-hidden`, unfocusable). They
 * appear only while content actually hides behind that edge; keyboard users
 * reach items by focusing them, which `scroll-padding-inline` keeps clear of
 * both the paddle and the fade beside it.
 *
 * **Drag to scroll** (`dragScroll`, on by default): a mouse press that
 * travels more than a few pixels sideways scrolls the row with the pointer
 * and grabs it (pointer capture, so leaving the row keeps dragging); the
 * click that ends a drag is swallowed, so letting go over a chip's remove
 * button never removes it. A press that does not travel stays a click.
 * Touch and pen never take this path: they scroll the row natively. While
 * drag scroll is on, the row's items cannot be dragged natively (a link or
 * an image would start the browser's own drag instead) — turn it off for
 * items that drag themselves.
 *
 * LTR only, as core's: the scroll arithmetic is physical (`scrollLeft`).
 *
 * Host knobs: `--overflow-row-surface` (paddle + fade), `--overflow-row-gap`,
 * `--overflow-row-paddle-size` (default `2rem`; drives the fade width and the
 * chevron too), `--overflow-row-focus-reach`.
 */
@Component({
  selector: 'overflow-row',
  imports: [MatIconButton, MatIcon],
  templateUrl: './overflow-row.html',
  styleUrl: './overflow-row.scss',
  host: {
    '[attr.data-dragging]': "dragging() ? '' : null",
  },
})
export class OverflowRow {
  /** Optional role on the inner flex row — `radiogroup` for a chip cloud. */
  readonly rowRole = input<OverflowRowRole | null>(null);

  /** Accessible name of the row — pass it already translated. */
  readonly rowLabel = input<string>('');

  /** Whether a mouse drag scrolls the row. On by default; off, only the
      paddles, the wheel and focus move it. */
  readonly dragScroll = input(true, { transform: booleanAttribute });

  protected readonly canScrollStart = signal(false);
  protected readonly canScrollEnd = signal(false);

  /** Something hides behind an edge: the items do not fit the row. For a
      host's own controls that only matter then (a layout switch). */
  readonly overflows = computed(() => this.canScrollStart() || this.canScrollEnd());

  /** A drag is scrolling the row (`data-dragging` on the host). */
  protected readonly dragging = signal(false);

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  /** The press a drag may grow out of: where it started, and the scroll
      then. */
  #press: { id: number; x: number; scrollLeft: number } | null = null;

  /** The click that ends a drag is the drag's, not the item's. */
  #swallowClick = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.syncPaddles();

      // Covers everything the scroll event does not: the host resizing, and
      // the row growing when projected items arrive after first paint. The row
      // is `max-content`, so any item added, removed or relabelled changes its
      // width — no MutationObserver needed on top.
      const scroller = this.scroller().nativeElement;
      const observer =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.syncPaddles());
      observer?.observe(scroller);
      if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);

      // Capture: the swallowed click must not reach the item it lands on,
      // which hears it before the row would in the bubbling phase.
      const onClick = (event: MouseEvent) => {
        if (!this.#swallowClick) return;
        this.#swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
      };
      scroller.addEventListener('click', onClick, true);

      destroyRef.onDestroy(() => {
        observer?.disconnect();
        scroller.removeEventListener('click', onClick, true);
      });
    });
  }

  /** A paddle shows only while items actually hide behind that edge. */
  protected syncPaddles(): void {
    const el = this.scroller().nativeElement;
    // ±1px slack: fractional layout widths leave sub-pixel remainders.
    this.canScrollStart.set(el.scrollLeft > 1);
    this.canScrollEnd.set(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }

  protected page(direction: 1 | -1): void {
    const el = this.scroller().nativeElement;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduced ? 'auto' : 'smooth';
    // Two thirds of a viewport per press keeps the last visible item on screen
    // as a landmark across the jump.
    el.scrollBy({ left: direction * el.clientWidth * 0.66, behavior });
  }

  /** A mouse's main button, on a row with somewhere to go: a drag may start. */
  protected onPointerDown(event: PointerEvent): void {
    this.#swallowClick = false;
    if (!this.dragScroll() || event.pointerType !== 'mouse' || event.button !== 0) return;
    const el = this.scroller().nativeElement;
    if (el.scrollWidth <= el.clientWidth) return;
    this.#press = { id: event.pointerId, x: event.clientX, scrollLeft: el.scrollLeft };
  }

  protected onPointerMove(event: PointerEvent): void {
    const press = this.#press;
    if (!press || event.pointerId !== press.id) return;
    const el = this.scroller().nativeElement;
    const dx = event.clientX - press.x;
    if (!this.dragging()) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      // A drag from here on: the row holds the pointer wherever it goes, and
      // no text is selected on the way.
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is no longer active (let go between events): the drag
        // still follows it while it is over the row.
      }
      this.dragging.set(true);
    }
    event.preventDefault();
    el.scrollLeft = press.scrollLeft - dx;
  }

  /** Let go: a drag swallows the click that follows it. */
  protected onPointerUp(event: PointerEvent): void {
    if (!this.#press || event.pointerId !== this.#press.id) return;
    this.#press = null;
    if (!this.dragging()) return;
    this.dragging.set(false);
    // The click comes in the same task as the pointerup, if at all: one
    // that never comes must not swallow a later one (a key's, say).
    this.#swallowClick = event.type === 'pointerup';
    setTimeout(() => (this.#swallowClick = false));
    if (this.scroller().nativeElement.hasPointerCapture(event.pointerId)) {
      this.scroller().nativeElement.releasePointerCapture(event.pointerId);
    }
  }

  /** The browser's own drag of a link or an image would steal the press,
      and a selection would grow along with the drag: neither starts from a
      press that may become one. */
  protected onPressDefault(event: Event): void {
    if (this.#press) event.preventDefault();
  }
}
