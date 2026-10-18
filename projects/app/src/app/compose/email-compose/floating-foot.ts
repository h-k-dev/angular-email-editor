import { DestroyRef, Directive, ElementRef, afterNextRender, inject, signal } from '@angular/core';
import { Plugin } from 'prosemirror-state';

// Library
import { FunctionalExtension, defineExtension } from '@h-k-dev/angular-email-editor';

/**
 * The composer's foot, floating: the attachment strip, the dock (the chat
 * and the formatting toolbar) and the room a frame's bar takes under them
 * lie OVER the foot of the scrolling text instead of under it — Gemini's
 * prompt box over its conversation. The text scrolls on beneath them, the
 * scroller never changes size for them (a toolbar switched on or off, the
 * chat opening, a chip added: the text box stays put and nothing in it is
 * laid out again), and whatever they do with their own height — the dock's
 * animated switch among it — happens over the text.
 *
 * This measures what the foot covers (`room`, px) so the text can keep that
 * much clear at its end: the last line scrolls up out from under the foot,
 * never stays behind it. The stylesheet reads it as a token
 * (`--email-compose-foot-room`, set by the composer) for the text's own end
 * room, the scrollbar track's end and the surface hint's foot; the caret
 * reads it through {@link footClearance}.
 *
 * A child whose height runs to a held one (`DockAnimation` holds the dock's
 * target in its inline height while the transition moves it there) counts
 * at that target: the room is where the foot is going, set once per change
 * — never a write per frame of the motion.
 */
@Directive({ selector: '[floatingFoot]' })
export class FloatingFoot {
  /** What the foot covers of the scroller's foot, px. */
  readonly room = signal(0);

  readonly #foot = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender({
      read: () => {
        this.#measure();
        if (typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(() => this.#measure());
        observer.observe(this.#foot);
        destroyRef.onDestroy(() => observer.disconnect());
      },
    });
  }

  #measure(): void {
    let height = this.#foot.getBoundingClientRect().height;
    // A child on its way to a held height: counted at it.
    for (const child of Array.from(this.#foot.children) as HTMLElement[]) {
      const held = parseFloat(child.style.height);
      if (Number.isFinite(held)) height += held - child.getBoundingClientRect().height;
    }
    this.room.set(Math.round(height));
  }
}

/**
 * The caret keeps clear of a floating foot: a selection that comes within
 * the foot's reach of the scroller's end (`scrollThreshold` — the browser's
 * own caret scroll stops right at the edge, under the foot) is scrolled up
 * to stand clear of it (`scrollMargin`). ProseMirror reads both each time it
 * scrolls, so `room` is asked then, as it stands. The other sides keep
 * ProseMirror's own: no threshold, a 5px margin.
 */
export function footClearance(room: () => number): FunctionalExtension {
  const threshold = {
    top: 0,
    right: 0,
    left: 0,
    get bottom() {
      return room();
    },
  };
  const margin = {
    top: 5,
    right: 5,
    left: 5,
    get bottom() {
      return room() + 5;
    },
  };
  return defineExtension({
    name: 'footClearance',
    plugins: () => [new Plugin({ props: { scrollThreshold: threshold, scrollMargin: margin } })],
  });
}
