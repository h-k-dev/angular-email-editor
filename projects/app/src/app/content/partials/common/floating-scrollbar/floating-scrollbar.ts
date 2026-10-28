import { Directive, ElementRef, afterRenderEffect, inject, input } from '@angular/core';

import { Viewport } from '../../../../core/layout/viewport';

/** How long the bar stays after the last scroll, in ms — then it fades. */
export const FLOATING_SCROLLBAR_LINGER = 1000;

/** The thumb never gets shorter than this, px: there is always something
    to take hold of, however long the text. */
const MIN_THUMB = 32;

/** The scroller's look the bar takes on: a sibling, it would inherit the
    parent's instead (the scroll mixin's tokens). */
const TOKENS = ['--email-scroll-size', '--email-scroll-thumb', '--email-scroll-thumb-hover'];

/**
 * A scroller's bar, floating — over the content, never beside it: no
 * gutter, nothing until a scroll is on, then a thumb along the end edge
 * that fades a moment after the scroll stops (macOS's own). Where the
 * platform's bars float already ({@link Viewport.floatingScrollbars}: a
 * Mac, a phone), they are left to it — the person's own setting, drawn by
 * the platform; this only hides a classic bar and draws one of its own in
 * its place. Vertical only.
 *
 *     <div class="pane" floatingScrollbar>…</div>
 *     .pane { overflow-y: auto }
 *
 * The drawn bar is a sibling laid over the scroller (`.floating-scrollbar`,
 * right after it), not a child: inside it would scroll with the text and
 * be put back a frame late, a jitter on every fast scroll. So the host's
 * parent chain needs a positioned box for the two to share (offsets are
 * the scroller's, applied to the bar). Nothing runs while the text sits
 * still: the bar is placed and sized as a scroll starts and on each one
 * after. A thumb can be dragged; a press on the rail beside it pages.
 * Not in the accessibility tree — the scroller scrolls by keys and wheel
 * as it is, the bar is for the eye and the pointer.
 *
 * The rail keeps clear of what is stuck over the scroller's ends — what its
 * block scroll padding says covers them (a stuck bar, the composer's
 * floating foot), the same padding that keeps a focused row and the caret
 * clear. Its look is global (styles/_floating-scrollbar.scss, in
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

/** Draws a floating bar for `scroller` until the returned function takes it away. */
function draw(scroller: HTMLElement): () => void {
  const document = scroller.ownerDocument;
  const window = document.defaultView;
  if (!window) return () => {};

  const bar = document.createElement('div');
  bar.className = 'floating-scrollbar';
  bar.setAttribute('aria-hidden', 'true');
  const rail = bar.appendChild(document.createElement('div'));
  rail.className = 'floating-scrollbar__rail';
  const thumb = rail.appendChild(document.createElement('div'));
  thumb.className = 'floating-scrollbar__thumb';
  scroller.after(bar);

  /** What a scroll moves: the scroll range and the thumb's, px. */
  let range = 0;
  let travel = 0;
  let thumbSize = 0;
  let hideTimer = 0;
  let hovered = false;
  let drag: { pointer: number; y: number; from: number } | null = null;

  /** Over the scroller — offsets are physical, so are these — and the
      thumb its share of the rail. */
  const measure = () => {
    bar.style.top = `${scroller.offsetTop}px`;
    bar.style.left = `${scroller.offsetLeft}px`;
    bar.style.height = `${scroller.offsetHeight}px`;
    bar.style.width = `${scroller.offsetWidth}px`;
    const style = getComputedStyle(scroller);
    // Over its scroller, however high that one stands (a menu over others).
    const z = parseInt(style.zIndex, 10);
    bar.style.zIndex = Number.isFinite(z) ? String(z + 1) : '';
    // The rail keeps clear of what is stuck over the scroller's ends.
    bar.style.setProperty('--_cover-start', `${parseFloat(style.scrollPaddingTop) || 0}px`);
    bar.style.setProperty('--_cover-end', `${parseFloat(style.scrollPaddingBottom) || 0}px`);
    for (const token of TOKENS) bar.style.setProperty(token, style.getPropertyValue(token));
    const { scrollHeight, clientHeight } = scroller;
    range = Math.max(0, scrollHeight - clientHeight);
    const length = rail.clientHeight;
    const size = range ? Math.min(length, Math.max(MIN_THUMB, (length * clientHeight) / scrollHeight)) : 0;
    if (size !== thumbSize) {
      thumbSize = size;
      thumb.style.blockSize = `${size}px`;
    }
    travel = Math.max(0, length - size);
  };

  const place = () => {
    const at = range ? (Math.min(range, scroller.scrollTop) / range) * travel : 0;
    thumb.style.transform = `translateY(${at}px)`;
  };

  const hideLater = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!hovered && !drag) bar.removeAttribute('data-shown');
    }, FLOATING_SCROLLBAR_LINGER);
  };

  const scrolled = () => {
    measure();
    place();
    if (range) bar.setAttribute('data-shown', '');
    hideLater();
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
    if (event.target === thumb) {
      rail.setPointerCapture?.(event.pointerId);
      drag = { pointer: event.pointerId, y: event.clientY, from: scroller.scrollTop };
      bar.setAttribute('data-dragging', '');
      return;
    }
    // The rail beside the thumb: a page towards the press.
    const thumbTop = thumb.getBoundingClientRect().top;
    const page = scroller.clientHeight * 0.9;
    scroller.scrollTop += event.clientY < thumbTop ? -page : page;
  };

  const moved = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer || !travel) return;
    // Instant, whatever the scroller's `scroll-behavior`: a smooth one
    // would animate every move, the text trailing the thumb.
    scroller.scrollTo({ top: drag.from + ((event.clientY - drag.y) * range) / travel, behavior: 'instant' });
  };

  const released = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = null;
    bar.removeAttribute('data-dragging');
    hideLater();
  };

  const swallow = (event: Event) => event.stopPropagation();

  scroller.addEventListener('scroll', scrolled, { passive: true });
  rail.addEventListener('pointerenter', entered);
  rail.addEventListener('pointerleave', left);
  rail.addEventListener('pointerdown', pressed);
  rail.addEventListener('pointermove', moved);
  rail.addEventListener('pointerup', released);
  rail.addEventListener('pointercancel', released);
  rail.addEventListener('click', swallow);

  return () => {
    window.clearTimeout(hideTimer);
    scroller.removeEventListener('scroll', scrolled);
    bar.remove();
  };
}
