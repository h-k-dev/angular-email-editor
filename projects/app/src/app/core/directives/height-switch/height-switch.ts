import { DestroyRef, Directive, ElementRef, afterNextRender, effect, inject, input } from '@angular/core';

/**
 * A box's height, run across a switch — the composer's dock (the formatting
 * toolbar shown or hidden under the AI chat), the attachment strip (one row
 * of chips or two). Born as the dock's own motion and moved here so every
 * switch of a box between two looks moves the same way.
 *
 * A height only transitions between lengths, never to or from `auto`: this
 * file owns the two numbers it runs between, which only exist on either
 * side of the switch, and the transition (inline, while it runs). The host's
 * stylesheet owns what does not fit yet — `[data-height-switch]` is on the
 * host while it runs, for its clip. A layout transition, the chat input's
 * own kind: run on the main thread, smooth with GPU acceleration off.
 */

/** How long a box takes to its new height, in ms. The box lets go of the
    height this long after it starts even when no `transitionend` comes (a
    tab that never paints). */
export const HEIGHT_SWITCH = 200;

/**
 * Runs the host's height from where it was to where a switch puts it.
 * `heightSwitch` is what the box switches on: a change of it arms the next
 * resize of the box's content (its first child, observed), and that resize
 * runs — from the box's last height, or from wherever a switch still
 * running has the box, to the new one. Both ends are the BOX's own height,
 * read, never the content's summed with the box's padding: content with
 * negative margins (a scrollport letting its focus rings out) is taller
 * than the room it takes, and a target summed from it overshoots, then
 * snaps back. Only a switch runs: the box follows
 * anything else at once (content with a transition of its own, the chat
 * input's, would lag behind two). Written in the observer, before the frame
 * paints, so the first frame is already the old height. Then `auto` again.
 * Nothing under reduced motion, on the server, or without a
 * `ResizeObserver`.
 *
 *     <div class="dock" [heightSwitch]="toolbar()">
 *       <div class="dock__content">…</div>
 *     </div>
 *
 * The host should be `box-sizing: border-box`, so the held height is the
 * height it measures.
 */
@Directive({ selector: '[heightSwitch]' })
export class HeightSwitch {
  /** What the box switches on: a change of it animates. */
  readonly heightSwitch = input<unknown>();

  readonly #box = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The box's own height for what it held, as last seen. */
  #height: number | null = null;

  /** A switch happened: the next resize is its, and runs. */
  #armed = false;

  /** Stops watching the running switch for its end. */
  #unwatch: (() => void) | null = null;

  constructor() {
    let first = true;
    effect(() => {
      this.heightSwitch();
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
        const content = this.#box.firstElementChild;
        if (!content || typeof ResizeObserver !== 'function') return;
        const observer = new ResizeObserver(() => this.#resized());
        observer.observe(content);
        destroyRef.onDestroy(() => {
          observer.disconnect();
          this.#unwatch?.();
        });
      },
    });
  }

  #resized(): void {
    const box = this.#box;
    // Mid-switch, the box is wherever the last one has it: from there. Read
    // before the natural height below lets go of the hold.
    const running = box.hasAttribute('data-height-switch');
    const shown = box.getBoundingClientRect().height;
    // The box's own height for what it now holds — its auto height, read
    // with any hold let go for the read.
    let height = shown;
    if (running) {
      const held = box.style.height;
      box.style.height = '';
      height = box.getBoundingClientRect().height;
      box.style.height = held;
    }
    const last = this.#height;
    this.#height = height;
    if (!this.#armed || last === null || Math.abs(last - height) < 1) return;
    this.#armed = false;
    const from = running ? shown : last;
    box.setAttribute('data-height-switch', '');
    box.style.transition = `height ${HEIGHT_SWITCH}ms ease`;
    box.style.height = `${from}px`;
    // The start, laid out — so the next height is a change to transition.
    void box.offsetHeight;
    box.style.height = `${height}px`;

    // The switch before this one, if it still runs, ends here: this one
    // takes the box on from where it had it.
    this.#unwatch?.();
    const ended = (event: TransitionEvent) => {
      if (event.target === box && event.propertyName === 'height') settle();
    };
    const settle = () => {
      this.#unwatch?.();
      box.style.height = '';
      box.style.transition = '';
      box.removeAttribute('data-height-switch');
    };
    box.addEventListener('transitionend', ended);
    const timer = setTimeout(settle, HEIGHT_SWITCH + 50);
    this.#unwatch = () => {
      clearTimeout(timer);
      box.removeEventListener('transitionend', ended);
      this.#unwatch = null;
    };
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
