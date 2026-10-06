import { DestroyRef, Directive, ElementRef, afterNextRender, effect, inject, input } from '@angular/core';

/**
 * The dock's motion: its height, run across a switch — the formatting
 * toolbar shown or hidden under the chat, the send button moving between
 * the strip and the toolbar's end. The stylesheet owns the picture
 * (`.dock--switching`: the `height` transition, the clip); this file owns
 * the two numbers it runs between, which only exist on either side of the
 * switch. A layout transition, the chat input's own kind: run on the main
 * thread, smooth with GPU acceleration off.
 */

/** How long the dock takes to its new height, in ms. Matches the
    stylesheet's transition; the dock lets go of the height this long after
    it starts even when no `transitionend` comes (a tab that never paints). */
export const DOCK_SWITCH = 200;

/**
 * Runs the dock's height from where it was to where a switch puts it.
 * `dockAnimation` is what the dock switches on: a change of it arms the
 * next resize of the dock's content (its one child, observed), and that
 * resize runs — from the content's last height, or from wherever a switch
 * still running has the dock, to the new one. Only a switch runs: the
 * dock follows anything else at once (the chat input growing has its own
 * transition; two would lag). Written in the observer, before the frame
 * paints, so the first frame is already the old height. Then `auto`
 * again. Nothing under reduced motion, on the server, or without a
 * `ResizeObserver`.
 *
 *     <div class="dock" [dockAnimation]="toolbar()">
 *       <div class="dock__content">…</div>
 *     </div>
 */
@Directive({ selector: '[dockAnimation]' })
export class DockAnimation {
  /** What the dock switches on: a change of it animates. */
  readonly dockAnimation = input<unknown>();

  readonly #dock = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The content's height, as the observer last saw it. */
  #height: number | null = null;

  /** A switch happened: the next resize is its, and runs. */
  #armed = false;

  /** Stops watching the running switch for its end. */
  #unwatch: (() => void) | null = null;

  constructor() {
    let first = true;
    effect(() => {
      this.dockAnimation();
      if (first) {
        first = false;
        return;
      }
      if (prefersReducedMotion()) return;
      this.#armed = true;
      // A switch that moves nothing leaves no resize: the arming lapses
      // after a whole frame, so a later, unrelated resize does not run.
      requestAnimationFrame(() => requestAnimationFrame(() => (this.#armed = false)));
    });
    const destroyRef = inject(DestroyRef);
    afterNextRender({
      read: () => {
        const content = this.#dock.firstElementChild;
        if (!content || typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(([entry]) =>
          this.#resized(entry.borderBoxSize?.[0]?.blockSize ?? content.getBoundingClientRect().height),
        );
        observer.observe(content);
        destroyRef.onDestroy(() => {
          observer.disconnect();
          this.#unwatch?.();
        });
      },
    });
  }

  #resized(height: number): void {
    const last = this.#height;
    this.#height = height;
    if (!this.#armed || last === null || Math.abs(last - height) < 1) return;
    this.#armed = false;
    const dock = this.#dock;
    const style = getComputedStyle(dock);
    const frame =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    // Mid-switch, the dock is wherever the last one has it: from there.
    const from = dock.classList.contains('dock--switching')
      ? dock.getBoundingClientRect().height
      : last + frame;
    dock.classList.add('dock--switching');
    dock.style.height = `${from}px`;
    // The start, laid out — so the next height is a change to transition.
    void dock.offsetHeight;
    dock.style.height = `${height + frame}px`;

    // The switch before this one, if it still runs, ends here: this one
    // takes the dock on from where it had it.
    this.#unwatch?.();
    const ended = (event: TransitionEvent) => {
      if (event.target === dock && event.propertyName === 'height') settle();
    };
    const settle = () => {
      this.#unwatch?.();
      dock.style.height = '';
      dock.classList.remove('dock--switching');
    };
    dock.addEventListener('transitionend', ended);
    const timer = setTimeout(settle, DOCK_SWITCH + 50);
    this.#unwatch = () => {
      clearTimeout(timer);
      dock.removeEventListener('transitionend', ended);
      this.#unwatch = null;
    };
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
