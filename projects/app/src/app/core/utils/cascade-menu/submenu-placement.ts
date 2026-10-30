import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

// Angular Aria
import { Menu } from '@angular/aria/menu';

export type SubmenuSide = 'right' | 'left';

/** What a list's place is worked out from — every box as laid out, in CSS
    pixels; the menu's in the viewport, the row's and the list's in the
    menu. */
export interface SubmenuGeometry {
  /** The menu the list stands in, in the viewport. */
  menu: { left: number; top: number; width: number };
  /** Where the list's top goes for its first row to be level with its row:
      the row's offset in the menu less the first row's offset in the list —
      so a heading over the rows stands above the row, not level with it. */
  rowTop: number;
  list: { width: number; height: number };
  viewport: { width: number; height: number };
  /** How far the list comes in over the menu's edge. */
  overlap: number;
  /** The room kept clear at the screen's edges. */
  margin: number;
  /** A box the list should not stand over — what the menu is about. */
  avoid?: { left: number; right: number } | null;
}

/** Where a list goes, in its menu: `left`/`top` for the stylesheet, and the
    side it went to. */
export interface SubmenuPlace {
  left: number;
  top: number;
  side: SubmenuSide;
}

/**
 * A cascading list's place, the way a desktop menu finds it: beside its
 * menu, over the edge by `overlap`, its first row level with its row (a
 * heading above it rises over the row).
 *
 * - **Side:** to the right — or to the left when what the menu is about
 *   (`avoid`) lies to the right, the way the menu itself went. The other
 *   side when the first has no room; neither — the roomier, pushed into
 *   the screen.
 * - **Height:** level with the row while the screen has room below; pushed
 *   up as far as it runs past, never past the top.
 */
export function placeSubmenu(g: SubmenuGeometry): SubmenuPlace {
  const x = { right: g.menu.width - g.overlap, left: g.overlap - g.list.width };
  const fits = (side: SubmenuSide) =>
    g.menu.left + x[side] >= g.margin &&
    g.menu.left + x[side] + g.list.width <= g.viewport.width - g.margin;
  const room = {
    right: g.viewport.width - g.margin - (g.menu.left + x.right),
    left: g.menu.left + g.overlap - g.margin,
  };
  const avoidLeft =
    !!g.avoid && (g.avoid.left + g.avoid.right) / 2 > g.menu.left + g.menu.width / 2;
  const order: SubmenuSide[] = avoidLeft ? ['left', 'right'] : ['right', 'left'];
  const side = order.find(fits) ?? (room.right >= room.left ? 'right' : 'left');
  return {
    side,
    left: clamp(
      x[side],
      g.margin - g.menu.left,
      g.viewport.width - g.margin - g.list.width - g.menu.left,
    ),
    top: clamp(
      g.rowTop,
      g.margin - g.menu.top,
      g.viewport.height - g.margin - g.list.height - g.menu.top,
    ),
  };
}

/** `value` between `min` and `max` — `min` when the two cross (a list wider
    than the screen starts at its edge). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Puts an Angular Aria submenu in its place each time it opens
 * (`placeSubmenu`): beside its row, on the side with room, pushed into the
 * screen. The list stands absolute in its menu (the menu is its offset
 * parent); the side it went to is on it as `data-side`, and where its row
 * stands down it as `--submenu-row-y` (the row's middle, from the list's
 * top) — what a motion grows it out of: a heading over its rows puts the
 * row below the list's top.
 *
 *     <div ngMenu menuSafeTriangle class="menu">          (position: relative)
 *       <div ngMenuItem [submenu]="sub">…</div>
 *       <div ngMenu #sub="ngMenu" submenuPlacement class="list">…</div>
 *     </div>                                            (.list: position: absolute)
 *
 * Measured in the render the list turns visible in — before it paints, so
 * it never shows in the wrong place. A menu that is still landing (scaled
 * by its popover's entry) measures small: the list is placed again once
 * the landing ends.
 */
@Directive({ selector: '[ngMenu][submenuPlacement]' })
export class SubmenuPlacement {
  /** A box the list should not stand over — what the menu is about (the
      grip that opened it), so the list goes the way the menu went. */
  readonly avoid = input<DOMRect | null | undefined>(null, { alias: 'submenuPlacementAvoid' });

  /** How far the list comes in over the menu's edge. */
  readonly overlap = input(6, { alias: 'submenuPlacementOverlap' });

  /** The room kept clear at the screen's edges — the popover's own. */
  readonly margin = input(8, { alias: 'submenuPlacementMargin' });

  readonly #menu = inject(Menu, { self: true });
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    afterRenderEffect({
      earlyRead: () => (this.#menu.visible() ? this.#measure(this.avoid()) : null),
      write: (place) => {
        const measured = place();
        if (!measured) return;
        this.#apply(measured.place);
        if (measured.landing.length) {
          void Promise.all(measured.landing.map((a) => a.finished))
            .then(() => {
              if (!this.#menu.visible()) return;
              const again = this.#measure(this.avoid());
              if (again) this.#apply(again.place);
            })
            .catch(() => undefined); // cancelled: the menu went away
        }
      },
    });
  }

  #measure(avoid: DOMRect | null | undefined) {
    const list = this.#host;
    const menu = list.offsetParent as HTMLElement | null;
    const row = this.#menu.parent()?.element as HTMLElement | undefined;
    if (!menu || !row) return null;
    const box = menu.getBoundingClientRect();
    const first = list.querySelector<HTMLElement>(':scope > [role^="menuitem"]');
    const firstTop = first
      ? list.clientTop + first.offsetTop
      : parseFloat(getComputedStyle(list).paddingTop) || 0;
    const root = document.documentElement;
    const place = placeSubmenu({
      menu: { left: box.left, top: box.top, width: menu.offsetWidth },
      rowTop: row.offsetTop - firstTop,
      list: { width: list.offsetWidth, height: list.offsetHeight },
      viewport: { width: root.clientWidth, height: root.clientHeight },
      overlap: this.overlap(),
      margin: this.margin(),
      avoid,
    });
    // Mid-landing the box is scaled: what moves it is somewhere above.
    const landing =
      Math.abs(box.width - menu.offsetWidth) > 0.5
        ? document.getAnimations().filter((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target;
            return a.playState === 'running' && !!target && target.contains(menu);
          })
        : [];
    // The row's middle, down the list — both in the menu.
    const rowY = row.offsetTop + row.offsetHeight / 2 - place.top;
    return { place: { ...place, rowY }, landing };
  }

  #apply(place: SubmenuPlace & { rowY: number }): void {
    this.#host.style.left = `${place.left}px`;
    this.#host.style.top = `${place.top}px`;
    this.#host.style.setProperty('--submenu-row-y', `${place.rowY}px`);
    this.#host.dataset['side'] = place.side;
  }
}
