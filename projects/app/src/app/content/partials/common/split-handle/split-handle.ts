import { DOCUMENT, Directive, ElementRef, inject, input, model, numberAttribute } from '@angular/core';

/** How far one arrow press moves the divider, px; with Shift, four times. */
const KEY_STEP = 16;

/** A press on the handle that may become a drag. */
interface Grab {
  readonly pointer: number;
  readonly x: number;
  readonly from: number;
  /** The widest it may go in this drag. */
  readonly ceiling: number;
  /** The size the drag has reached, not yet committed. */
  size: number;
  /** The frame queued to paint it, if one is. */
  frame: number;
}

/**
 * The divider of a two-column grid, as a handle: drag it, or focus it and
 * use the arrows, and the first column's width follows — a `separator` in
 * ARIA's sense, its value the width in px. The grid reads the width from a
 * CSS custom property (`splitProperty`, default `--split-size`) on
 * `splitTarget`:
 *
 *     <div class="grid" #grid [style.--list-width.px]="width()">
 *       <nav>…</nav>
 *       <div [(splitHandle)]="width" [splitTarget]="grid" splitProperty="--list-width"
 *            splitKeep="360"></div>
 *       <article>…</article>
 *     </div>
 *     .grid { grid-template-columns: min(var(--list-width), 100% - 360px) minmax(0, 1fr) }
 *
 * Built for drag performance: while the pointer moves, nothing runs through
 * Angular — each move writes the property straight onto the target, at most
 * once a frame, so the browser re-lays the grid and nothing else. The
 * model is written once, on release (and on each key press), and the
 * binding then holds the same value. The target carries `data-resizing`
 * while a drag is under way, for the stylesheet to keep the col-resize
 * cursor and stop text selection across the whole grid, and the handle
 * `data-dragging`, to stay lit (styles/_split-handle.scss: its look).
 *
 * The pane it sizes may be the last instead (`splitEdge="end"`): a panel on
 * the right, its handle on its start edge — a drag to the left widens it,
 * and so does ArrowLeft, the handle moving the way the key points.
 *
 *     <div [(splitHandle)]="width" [splitTarget]="grid" splitEdge="end"></div>
 *     .grid { grid-template-columns: minmax(0, 1fr) min(var(--split-size), 100% - 720px) }
 */
@Directive({
  selector: '[splitHandle]',
  host: {
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'vertical',
    '[attr.aria-valuenow]': 'size()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    '(pointerdown)': 'grab($event)',
    '(pointermove)': 'drag($event)',
    '(pointerup)': 'drop($event)',
    '(pointercancel)': 'drop($event)',
    '(keydown)': 'key($event)',
  },
})
export class SplitHandle {
  /** The sized column's width, px — committed on release. */
  readonly size = model.required<number>({ alias: 'splitHandle' });

  /** The element whose custom property sets the width: the grid. */
  readonly target = input.required<HTMLElement>({ alias: 'splitTarget' });

  /** The custom property the grid reads the width from. */
  readonly property = input('--split-size', { alias: 'splitProperty' });

  readonly min = input(0, { alias: 'splitMin', transform: numberAttribute });
  readonly max = input(Infinity, { alias: 'splitMax', transform: numberAttribute });

  /** Which column it sizes: the first (`start`), or the last (`end`) — the
      handle on that column's start edge, so a move to the left widens it. */
  readonly edge = input<'start' | 'end'>('start', { alias: 'splitEdge' });

  /** What the other column keeps at least, px: the width never reaches
      past the target's width minus this. The grid's own track says the
      same (`min(var(--size), 100% - <keep>)`), so the handle and the
      column never part on a narrow screen. */
  readonly keep = input(0, { alias: 'splitKeep', transform: numberAttribute });

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #window = inject(DOCUMENT).defaultView;
  #grab: Grab | null = null;

  /** The widest it may go now: its max, or what the target leaves after
      the second column's keep — read as a drag or a key starts, never on
      every move. */
  #ceiling(): number {
    const room = this.target().clientWidth - this.keep();
    return Math.max(this.min(), room > 0 ? Math.min(this.max(), room) : this.max());
  }

  #clamp(size: number, ceiling: number): number {
    return Math.round(Math.min(ceiling, Math.max(this.min(), size)));
  }

  /** Paints a width without Angular: the grid's property and the handle's
      value, written straight. */
  #paint(size: number): void {
    this.target().style.setProperty(this.property(), `${size}px`);
    this.#host.setAttribute('aria-valuenow', String(size));
  }

  protected grab(event: PointerEvent): void {
    if (event.button !== 0) return;
    // No text selection starts from the press.
    event.preventDefault();
    this.#host.focus({ preventScroll: true });
    this.#host.setPointerCapture?.(event.pointerId);
    const ceiling = this.#ceiling();
    // From where it stands: a width kept from a wider screen starts at the
    // ceiling, so the first move moves it.
    const from = this.#clamp(this.size(), ceiling);
    this.#grab = { pointer: event.pointerId, x: event.clientX, from, ceiling, size: from, frame: 0 };
    this.target().setAttribute('data-resizing', '');
    this.#host.setAttribute('data-dragging', '');
  }

  protected drag(event: PointerEvent): void {
    const grab = this.#grab;
    if (!grab || event.pointerId !== grab.pointer) return;
    const moved = event.clientX - grab.x;
    grab.size = this.#clamp(grab.from + (this.edge() === 'end' ? -moved : moved), grab.ceiling);
    if (grab.frame) return;
    grab.frame =
      this.#window?.requestAnimationFrame(() => {
        grab.frame = 0;
        this.#paint(grab.size);
      }) ?? 0;
  }

  protected drop(event: PointerEvent): void {
    const grab = this.#grab;
    if (!grab || event.pointerId !== grab.pointer) return;
    if (grab.frame) this.#window?.cancelAnimationFrame(grab.frame);
    this.#paint(grab.size);
    this.target().removeAttribute('data-resizing');
    this.#host.removeAttribute('data-dragging');
    this.#grab = null;
    this.size.set(grab.size);
  }

  /** The arrows move it a step (Shift: four) from where it stands — the
      handle the way the key points, so on an end column ArrowLeft widens
      it — Home and End to its least and most: the separator pattern's
      keys. */
  protected key(event: KeyboardEvent): void {
    const ceiling = this.#ceiling();
    const now = this.#clamp(this.size(), ceiling);
    const step = (event.shiftKey ? KEY_STEP * 4 : KEY_STEP) * (this.edge() === 'end' ? -1 : 1);
    const to =
      event.key === 'ArrowLeft'
        ? now - step
        : event.key === 'ArrowRight'
          ? now + step
          : event.key === 'Home'
            ? this.min()
            : event.key === 'End'
              ? ceiling
              : null;
    if (to === null) return;
    event.preventDefault();
    this.size.set(this.#clamp(to, ceiling));
  }
}
