import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

type Point = { x: number; y: number };

/**
 * macOS's grace for a cascading menu: with a list open beside a row, the
 * pointer heading for the list crosses the rows below (or above) the one
 * that opened it — a diagonal — and a plain hover would swap the list for
 * the crossed row's on the way. While the pointer stays inside the
 * triangle from where it just was to the list's near edge, a hover on
 * another row is not one: the event is stopped before the menu hears it
 * (`mouseover`, in the capture phase, ahead of Angular Aria's listener on
 * the same element). Stop moving inside the triangle and the grace ends
 * after a moment — the hover is replayed on the row under the pointer, so
 * a pointer that *rests* on a row still opens that row's list.
 *
 *     <div ngMenu menuSafeTriangle>…</div>
 *
 * Goes on the root menu; the open list is found by `list` (a selector,
 * Aria's `data-visible` by default), so any nesting works.
 */
@Directive({ selector: '[menuSafeTriangle]' })
export class MenuSafeTriangle {
  /** The open list, as a selector under the host. */
  readonly list = input('[data-visible="true"]', { alias: 'menuSafeTriangleList' });

  /** How long the pointer may rest inside the triangle before the hover
      under it counts. */
  readonly rest = input(300, { alias: 'menuSafeTriangleRest' });

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Where the pointer was at its last move in the menu — the triangle's
      apex: a `mouseover` comes ahead of the move that caused it, so at
      that moment this is still where the pointer came from. */
  #apex: Point | null = null;

  #restTimer: ReturnType<typeof setTimeout> | undefined;

  /** A replayed hover is on its way: it is the pointer's own, not graced. */
  #replaying = false;

  /** The grace is on: a hover is being held back — `data-grace` on the
      host, for the stylesheet, so the crossed row does not light up. */
  #grace = false;

  constructor() {
    const onMove = (event: MouseEvent) => {
      this.#apex = { x: event.clientX, y: event.clientY };
    };
    const onOver = (event: MouseEvent) => {
      if (this.#replaying || !this.#inGrace(event)) {
        this.#setGrace(false);
        return;
      }
      event.stopPropagation();
      this.#setGrace(true);
      clearTimeout(this.#restTimer);
      this.#restTimer = setTimeout(() => this.#replay(), this.rest());
    };
    // Out of the menu, the grace is over — and there is nothing to replay.
    const onLeave = () => {
      this.#apex = null;
      clearTimeout(this.#restTimer);
      this.#setGrace(false);
    };
    this.#host.addEventListener('mousemove', onMove, true);
    this.#host.addEventListener('mouseover', onOver, true);
    this.#host.addEventListener('mouseleave', onLeave);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.#restTimer);
      this.#host.removeEventListener('mousemove', onMove, true);
      this.#host.removeEventListener('mouseover', onOver, true);
      this.#host.removeEventListener('mouseleave', onLeave);
    });
  }

  /** Whether the hover is on the way to the open list: the pointer inside
      the triangle from its last position to the list's near edge — and
      not in the list itself, nor on the row that opened it. */
  #inGrace(event: MouseEvent): boolean {
    const list = this.#host.querySelector<HTMLElement>(this.list());
    const apex = this.#apex;
    const target = event.target as Element | null;
    if (!list || !apex || !target || list.contains(target)) return false;
    const rect = list.getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    // The list stands to the right of the menu, or to the left: its near
    // edge is the one facing where the pointer came from.
    const edge = apex.x < rect.left + rect.width / 2 ? rect.left : rect.right;
    return inTriangle(point, apex, { x: edge, y: rect.top }, { x: edge, y: rect.bottom });
  }

  /** The pointer rested: the row under it gets the hover it was denied. */
  #replay(): void {
    this.#setGrace(false);
    const point = this.#apex;
    if (!point) return;
    const under = document.elementFromPoint(point.x, point.y);
    if (!under || !this.#host.contains(under)) return;
    this.#replaying = true;
    try {
      under.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, clientX: point.x, clientY: point.y }),
      );
    } finally {
      this.#replaying = false;
    }
  }

  #setGrace(on: boolean): void {
    if (this.#grace === on) return;
    this.#grace = on;
    if (on) this.#host.setAttribute('data-grace', '');
    else this.#host.removeAttribute('data-grace');
  }
}

/** Whether `p` lies in the triangle `a b c` (same side of all three
    edges); a degenerate triangle holds nothing. */
function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  if (d1 === 0 && d2 === 0 && d3 === 0) return false;
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}
