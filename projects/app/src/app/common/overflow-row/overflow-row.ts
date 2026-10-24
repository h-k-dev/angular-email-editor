import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
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
 * both the paddle and the fade beside it. `paddles` (on by default) turns
 * them off — on a touch screen, where a finger scrolls the row anyway.
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
 * **Native when it can be.** Both off, the row is the platform's own
 * scroller with its bar hidden: no paddle, and no pointer listener — the
 * drag's are added only while `dragScroll` is on. The component asks no
 * device what it is: a parent that knows (a touch screen, say) passes
 * `[paddles]="false" [dragScroll]="false"`. `overflows` is measured
 * either way.
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
    '[attr.data-paddles]': "paddles() ? '' : null",
  },
})
export class OverflowRow {
  /** Optional role on the inner flex row — `radiogroup` for a chip cloud. */
  readonly rowRole = input<OverflowRowRole | null>(null);

  /** Accessible name of the row — pass it already translated. */
  readonly rowLabel = input<string>('');

  /** Whether a mouse drag scrolls the row. On by default; off, the row
      holds no pointer listener: the paddles, the wheel, a finger and focus
      move it, as the platform does. */
  readonly dragScroll = input(true, { transform: booleanAttribute });

  /** Whether paddles stand over an edge that hides items. On by default;
      off, the row keeps no room for them either. */
  readonly paddles = input(true, { transform: booleanAttribute });

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
      destroyRef.onDestroy(() => observer?.disconnect());
    });

    // The drag's listeners, only while it is on: off, the scroller is left
    // to the platform alone.
    afterRenderEffect({
      write: (onCleanup) => {
        if (!this.dragScroll()) return;
        const scroller = this.scroller().nativeElement;
        const onPress = (event: Event) => this.#onPressDefault(event);
        // Capture: the swallowed click must not reach the item it lands on,
        // which hears it before the row would in the bubbling phase.
        const onClick = (event: Event) => {
          if (!this.#swallowClick) return;
          this.#swallowClick = false;
          event.preventDefault();
          event.stopPropagation();
        };
        const listeners: [string, (event: Event) => void, boolean][] = [
          ['pointerdown', (event) => this.#onPointerDown(event as PointerEvent), false],
          ['pointermove', (event) => this.#onPointerMove(event as PointerEvent), false],
          ['pointerup', (event) => this.#onPointerUp(event as PointerEvent), false],
          ['pointercancel', (event) => this.#onPointerUp(event as PointerEvent), false],
          ['dragstart', onPress, false],
          ['selectstart', onPress, false],
          ['click', onClick, true],
        ];
        for (const [type, listener, capture] of listeners) {
          scroller.addEventListener(type, listener, capture);
        }
        onCleanup(() => {
          for (const [type, listener, capture] of listeners) {
            scroller.removeEventListener(type, listener, capture);
          }
          this.#press = null;
          this.#swallowClick = false;
          this.dragging.set(false);
        });
      },
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
  #onPointerDown(event: PointerEvent): void {
    this.#swallowClick = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const el = this.scroller().nativeElement;
    if (el.scrollWidth <= el.clientWidth) return;
    this.#press = { id: event.pointerId, x: event.clientX, scrollLeft: el.scrollLeft };
  }

  #onPointerMove(event: PointerEvent): void {
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
  #onPointerUp(event: PointerEvent): void {
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
  #onPressDefault(event: Event): void {
    if (this.#press) event.preventDefault();
  }
}
