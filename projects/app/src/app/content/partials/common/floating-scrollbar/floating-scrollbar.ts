import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

import { Viewport } from '../../../../core/layout/viewport';

/** How long the bar stays after the last scroll, in ms — then it fades. */
export const FLOATING_SCROLLBAR_LINGER = 1000;

/** How long a rail takes to fade out, ms — the stylesheet's (opacity
    300ms): the bar keeps its size until then. */
const FADE_OUT = 300;

/** The thumb never gets shorter than this, px: there is always something
    to take hold of, however long the text. */
const MIN_THUMB = 32;

/** The scroller's look the bar takes on: a sibling, it would inherit the
    parent's instead (the scroll mixin's tokens). */
const TOKENS = [
  '--email-scroll-size',
  '--email-scroll-thumb',
  '--email-scroll-thumb-hover',
  '--email-scroll-across-end',
];

/**
 * A scroller's bars, floating — over the content, never beside it: no
 * gutter, nothing until a scroll is on, then a thumb along the end edge
 * (scrolling down) or the foot (scrolling across) that fades a moment after
 * the scroll stops (macOS's own). Where the
 * platform's bars float already ({@link Viewport.floatingScrollbars}: a
 * Mac, a phone), they are left to it — the person's own setting, drawn by
 * the platform; this only hides a classic bar and draws one of its own in
 * its place — both ways: the platform's bar hidden is hidden for either
 * axis, so each gets a drawn one. Across, the thumb also shows while the
 * pointer is over a scroller that runs on sideways: a wheel scrolls down,
 * and nothing else would tell there is more to the side.
 *
 *     <div class="pane" floatingScrollbar>…</div>
 *     .pane { overflow-y: auto }
 *
 * The drawn bar is a sibling laid over the scroller (`.floating-scrollbar`,
 * right after it), not a child: inside it would scroll with the text and
 * be put back a frame late, a jitter on every fast scroll. So the host's
 * parent chain needs a positioned box for the two to share (offsets are
 * the scroller's, applied to the bar). Nothing runs while the text sits
 * still: the bars are placed and sized as a scroll starts and on each one
 * after. A thumb can be dragged; a press on the rail beside it pages.
 * Not in the accessibility tree — the scroller scrolls by keys and wheel
 * as it is, the bar is for the eye and the pointer.
 *
 * The rails keep clear of what is stuck over the scroller's ends — what its
 * block scroll padding says covers them (a stuck bar, the composer's
 * floating foot), the same padding that keeps a focused row and the caret
 * clear: the down rail runs between them, the across rail stands on the
 * foot's. Its look is global (styles/_floating-scrollbar.scss, in
 * styles.scss), on the scroller's own `--email-scroll-*` tokens — so a
 * scroller in the scroll mixin's skin keeps it, its bar floating (the
 * mixin leaves the bar to `[data-floating-scrollbar]`).
 *
 * The scroller is the host — or, the attribute's value a selector, the
 * element inside the host it names: a component whose scroller is its own
 * (the library's suggestion menu's list) takes the bar from outside.
 *
 *     <div email-suggestion-menu floatingScrollbar="[data-slot=listbox]">
 */
@Directive({
  selector: '[floatingScrollbar]',
  host: {
    '[attr.data-floating-scrollbar]': "floatingScrollbar() ? null : native() ? 'native' : 'drawn'",
  },
})
export class FloatingScrollbar {
  /** The scroller inside the host, as a selector — empty for the host. */
  readonly floatingScrollbar = input('');

  protected readonly native = inject(Viewport).floatingScrollbars;
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    // A mouse plugged into a Mac set to follow it turns its bars classic,
    // and this draws one; unplugged, the drawn one goes.
    afterRenderEffect((onCleanup) => {
      const selector = this.floatingScrollbar();
      const scroller = selector ? this.#host.querySelector<HTMLElement>(selector) : this.#host;
      if (!scroller) return;
      const native = this.native();
      if (selector) {
        // The host binding's attribute, on the scroller it names.
        scroller.setAttribute('data-floating-scrollbar', native ? 'native' : 'drawn');
        onCleanup(() => scroller.removeAttribute('data-floating-scrollbar'));
      }
      if (native) return;
      onCleanup(draw(scroller));
    });
  }
}

/** Down the scroller, or across it. */
type Axis = 'block' | 'inline';

/** Draws the floating bars for `scroller` until the returned function takes them away. */
function draw(scroller: HTMLElement): () => void {
  const document = scroller.ownerDocument;
  const window = document.defaultView;
  if (!window) return () => {};

  const bar = document.createElement('div');
  bar.className = 'floating-scrollbar';
  bar.setAttribute('aria-hidden', 'true');
  scroller.after(bar);

  /** Over the scroller — offsets are physical, so are these — in its
      look, clear of what is stuck over its ends. */
  const place = () => {
    bar.style.top = `${scroller.offsetTop}px`;
    bar.style.left = `${scroller.offsetLeft}px`;
    bar.style.height = `${scroller.offsetHeight}px`;
    bar.style.width = `${scroller.offsetWidth}px`;
    const style = getComputedStyle(scroller);
    // Over its scroller, however high that one stands (a menu over others).
    const z = parseInt(style.zIndex, 10);
    bar.style.zIndex = Number.isFinite(z) ? String(z + 1) : '';
    bar.style.setProperty('--_cover-start', `${parseFloat(style.scrollPaddingTop) || 0}px`);
    bar.style.setProperty('--_cover-end', `${parseFloat(style.scrollPaddingBottom) || 0}px`);
    for (const token of TOKENS) bar.style.setProperty(token, style.getPropertyValue(token));
  };

  // Out of sight, no size: a bar placed for a scroller that has since
  // narrowed (a paper back to its column) would hold the room it last
  // covered and widen what scrolls round it. Placed again as a rail shows.
  const collapse = () => {
    if (bar.querySelector('[data-shown]')) return;
    bar.style.width = '0px';
    bar.style.height = '0px';
  };
  collapse();

  // After the rail's fade: a rail shown again meanwhile keeps it placed.
  let collapseTimer = 0;
  const hidden = () => {
    window.clearTimeout(collapseTimer);
    collapseTimer = window.setTimeout(collapse, FADE_OUT);
  };

  const down = rail(scroller, bar, 'block', place, hidden);
  const across = rail(scroller, bar, 'inline', place, hidden);

  /** Where the scroll stood, to tell which way it went. */
  let top = scroller.scrollTop;
  let left = scroller.scrollLeft;

  const scrolled = () => {
    if (scroller.scrollTop !== top) down.show();
    if (scroller.scrollLeft !== left) across.show();
    top = scroller.scrollTop;
    left = scroller.scrollLeft;
  };

  // Across, the pointer over the scroller shows the bar until it leaves.
  const over = () => across.hold(true);
  const out = () => across.hold(false);

  scroller.addEventListener('scroll', scrolled, { passive: true });
  scroller.addEventListener('pointerenter', over);
  scroller.addEventListener('pointerleave', out);

  return () => {
    window.clearTimeout(collapseTimer);
    down.remove();
    across.remove();
    scroller.removeEventListener('scroll', scrolled);
    scroller.removeEventListener('pointerenter', over);
    scroller.removeEventListener('pointerleave', out);
    bar.remove();
  };
}

/** One of the bar's two rails and its thumb: shown, placed, dragged. */
function rail(
  scroller: HTMLElement,
  bar: HTMLElement,
  axis: Axis,
  place: () => void,
  hidden: () => void,
) {
  const document = scroller.ownerDocument;
  const window = document.defaultView!;
  const down = axis === 'block';

  const rail = bar.appendChild(document.createElement('div'));
  rail.className = 'floating-scrollbar__rail';
  rail.setAttribute('data-axis', axis);
  const thumb = rail.appendChild(document.createElement('div'));
  thumb.className = 'floating-scrollbar__thumb';

  /** Where the scroll stands, and where a pointer is — along this rail. */
  const scrolled = () => (down ? scroller.scrollTop : scroller.scrollLeft);
  const along = (event: PointerEvent) => (down ? event.clientY : event.clientX);

  /** What a scroll moves: the scroll range and the thumb's, px. */
  let range = 0;
  let travel = 0;
  let thumbSize = 0;
  let hideTimer = 0;
  let hovered = false;
  let held = false;
  let drag: { pointer: number; at: number; from: number } | null = null;

  /** The thumb its share of the rail, where the scroll is. */
  const measure = () => {
    place();
    const [scrollSize, clientSize, length] = down
      ? [scroller.scrollHeight, scroller.clientHeight, rail.clientHeight]
      : [scroller.scrollWidth, scroller.clientWidth, rail.clientWidth];
    range = Math.max(0, scrollSize - clientSize);
    const size = range ? Math.min(length, Math.max(MIN_THUMB, (length * clientSize) / scrollSize)) : 0;
    if (size !== thumbSize) {
      thumbSize = size;
      thumb.style[down ? 'blockSize' : 'inlineSize'] = `${size}px`;
    }
    travel = Math.max(0, length - size);
    const at = range ? (Math.min(range, scrolled()) / range) * travel : 0;
    thumb.style.transform = down ? `translateY(${at}px)` : `translateX(${at}px)`;
  };

  const hideLater = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (hovered || held || drag) return;
      rail.removeAttribute('data-shown');
      hidden();
    }, FLOATING_SCROLLBAR_LINGER);
  };

  /** Shown — where there is anything to scroll — and fading after. */
  const show = () => {
    measure();
    if (range) rail.setAttribute('data-shown', '');
    hideLater();
  };

  /** Kept shown while something holds it (the pointer over the scroller). */
  const hold = (on: boolean) => {
    held = on;
    if (on) show();
    else hideLater();
  };

  const entered = () => {
    hovered = true;
    window.clearTimeout(hideTimer);
  };

  const left = () => {
    hovered = false;
    hideLater();
  };

  // A press here is the bar's alone: no caret placed, no text selected, no
  // marquee started in the composer underneath.
  const pressed = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // From the scroll as it stands now: the other way's scroll may have
    // moved it since this rail was last measured.
    measure();
    if (event.target === thumb) {
      rail.setPointerCapture?.(event.pointerId);
      drag = { pointer: event.pointerId, at: along(event), from: scrolled() };
      rail.setAttribute('data-dragging', '');
      return;
    }
    // The rail beside the thumb: a page towards the press.
    const box = thumb.getBoundingClientRect();
    const before = along(event) < (down ? box.top : box.left);
    const page = (down ? scroller.clientHeight : scroller.clientWidth) * 0.9 * (before ? -1 : 1);
    if (down) scroller.scrollTop += page;
    else scroller.scrollLeft += page;
  };

  const moved = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer || !travel) return;
    // Instant, whatever the scroller's `scroll-behavior`: a smooth one
    // would animate every move, the text trailing the thumb.
    const to = drag.from + ((along(event) - drag.at) * range) / travel;
    scroller.scrollTo({ [down ? 'top' : 'left']: to, behavior: 'instant' });
  };

  const released = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = null;
    rail.removeAttribute('data-dragging');
    hideLater();
  };

  const swallow = (event: Event) => event.stopPropagation();

  rail.addEventListener('pointerenter', entered);
  rail.addEventListener('pointerleave', left);
  rail.addEventListener('pointerdown', pressed);
  rail.addEventListener('pointermove', moved);
  rail.addEventListener('pointerup', released);
  rail.addEventListener('pointercancel', released);
  rail.addEventListener('click', swallow);

  return { show, hold, remove: () => window.clearTimeout(hideTimer) };
}
