import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

export type Point = { x: number; y: number };

/** How many of the pointer's last positions are kept — the triangle's apex
    is the oldest of them, so one jittery step (a pixel straight down on a
    diagonal) cannot turn the pointer's heading. menu-aim's number. */
export const SAFE_TRIANGLE_TRACKED = 3;

/** Where a list stands from what opened it: beside it (`inline`, a
    cascading menu's) or over or under it (`block`, a toolbar's second row). */
export type SafeTriangleAxis = 'inline' | 'block';

/**
 * Whether the pointer, gone from `from` to `to`, is heading for `list`: `to`
 * lies in the triangle from `from` to the list's near edge, that edge
 * stretched by `tolerance` past both its ends — the list's first and last
 * rows are aimed at as easily as its middle. A pointer that has not moved
 * heads nowhere.
 */
export function aimsAt(
  from: Point,
  to: Point,
  list: DOMRect,
  tolerance: number,
  axis: SafeTriangleAxis = 'inline',
): boolean {
  if (from.x === to.x && from.y === to.y) return false;
  if (axis === 'block') {
    // The list stands above, or below: its near edge is the one facing
    // where the pointer came from.
    const edge = from.y < list.top + list.height / 2 ? list.top : list.bottom;
    return inTriangle(
      to,
      from,
      { x: list.left - tolerance, y: edge },
      { x: list.right + tolerance, y: edge },
    );
  }
  // The list stands to the right of the menu, or to the left: its near edge
  // is the one facing where the pointer came from.
  const edge = from.x < list.left + list.width / 2 ? list.left : list.right;
  return inTriangle(
    to,
    from,
    { x: edge, y: list.top - tolerance },
    { x: edge, y: list.bottom + tolerance },
  );
}

/**
 * menu-aim's grace for a cascading menu (jQuery-menu-aim, macOS before it):
 * with a list open beside a row, the pointer heading for the list crosses
 * the rows below (or above) the one that opened it — a diagonal — and a
 * plain hover would swap the list for the crossed row's on the way. While
 * the pointer heads for the list (`aimsAt`, from the oldest of its last
 * few positions), a hover on another row is not one: the event is stopped
 * before the menu hears it (`mouseover`, in the capture phase, ahead of
 * Angular Aria's listener on the same element).
 *
 * The grace is looked at again every `rest`: still heading for the list,
 * it holds; stopped, or turned away, it ends — and the hover is replayed on
 * the row under the pointer, so a pointer that *rests* on a row still opens
 * that row's list, however slowly it got there.
 *
 *     <div ngMenu menuSafeTriangle>…</div>
 *
 * Goes on the root menu; the open list is found by `list` (a selector,
 * Aria's `data-visible` by default — the deepest one open), so any nesting
 * works, and so does a list on either side (`SubmenuPlacement`).
 */
@Directive({ selector: '[menuSafeTriangle]' })
export class MenuSafeTriangle {
  /** The open list, as a selector under the host. */
  readonly list = input('[data-visible="true"]', { alias: 'menuSafeTriangleList' });

  /** How often the grace is looked at again — how long a pointer must rest
      before the hover under it counts. menu-aim's 300ms. */
  readonly rest = input(300, { alias: 'menuSafeTriangleRest' });

  /** How far past the list's ends the pointer may aim and still be heading
      for it. menu-aim's 75px. */
  readonly tolerance = input(75, { alias: 'menuSafeTriangleTolerance' });

  /** Where the list stands from what opened it: beside it (a cascading
      menu's, the default) or over or under it (`block`: a toolbar's second
      row, the bubble menu's). */
  readonly axis = input<SafeTriangleAxis>('inline', { alias: 'menuSafeTriangleAxis' });

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The pointer's last positions in the menu, oldest first. A `mouseover`
      comes ahead of the move that caused it, so at that moment these are
      all where the pointer came from. */
  #trail: Point[] = [];

  /** Where the pointer was when the grace was last looked at. */
  #checked: Point | null = null;

  #restTimer: ReturnType<typeof setTimeout> | undefined;

  /** A replayed hover is on its way: it is the pointer's own, not graced. */
  #replaying = false;

  /** The grace is on: a hover is being held back — `data-grace` on the
      host, for the stylesheet, so the crossed row does not light up. */
  #grace = false;

  constructor() {
    const onMove = (event: MouseEvent) => {
      this.#trail.push({ x: event.clientX, y: event.clientY });
      if (this.#trail.length > SAFE_TRIANGLE_TRACKED) this.#trail.shift();
    };
    const onOver = (event: MouseEvent) => {
      if (this.#replaying) return;
      const list = this.#openList();
      const target = event.target as Element | null;
      const from = this.#trail[0];
      const to = { x: event.clientX, y: event.clientY };
      // On the list, or on the row that opened it, there is nothing to hold.
      if (
        !list ||
        !target ||
        !from ||
        list.contains(target) ||
        target.closest('[aria-expanded="true"]') ||
        !aimsAt(from, to, list.getBoundingClientRect(), this.tolerance(), this.axis())
      ) {
        this.#end();
        return;
      }
      event.stopPropagation();
      this.#setGrace(true);
      this.#checked = to;
      this.#schedule();
    };
    // Out of the menu, the grace is over — and there is nothing to replay.
    const onLeave = () => {
      this.#trail = [];
      this.#end();
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

  /** The deepest list open under the host. */
  #openList(): HTMLElement | null {
    const lists = this.#host.querySelectorAll<HTMLElement>(this.list());
    return lists[lists.length - 1] ?? null;
  }

  #schedule(): void {
    clearTimeout(this.#restTimer);
    this.#restTimer = setTimeout(() => this.#recheck(), this.rest());
  }

  /** menu-aim's second look: moved since the last one, and still heading
      for the list — the grace holds; otherwise the row under the pointer
      gets the hover it was denied. */
  #recheck(): void {
    const list = this.#openList();
    const now = this.#trail[this.#trail.length - 1];
    const from = this.#trail[0];
    const moved = !!now && (now.x !== this.#checked?.x || now.y !== this.#checked?.y);
    const aims =
      !!list &&
      !!now &&
      aimsAt(from, now, list.getBoundingClientRect(), this.tolerance(), this.axis());
    if (moved && aims) {
      this.#checked = now;
      this.#schedule();
      return;
    }
    this.#end();
    if (now) this.#replay(now);
  }

  /** The row under the pointer gets its hover. */
  #replay(point: Point): void {
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

  #end(): void {
    clearTimeout(this.#restTimer);
    this.#checked = null;
    this.#setGrace(false);
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
