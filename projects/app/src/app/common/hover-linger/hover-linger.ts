import { Directive, computed, debounced, input, numberAttribute, signal } from '@angular/core';

/** How long the host stays shown after the pointer and focus have left, in
    ms — generous: a hand that overshoots the corner and comes back finds it
    still there. */
export const HOVER_LINGER = 1000;

/**
 * `:hover` / `:focus-within` that lingers: `data-hover-linger` is on the
 * host at once while the pointer is on it or focus is inside it, and stays
 * `hoverLinger` ms (default {@link HOVER_LINGER}) after both have left — for
 * a menu shown on hover that must not vanish the moment the hand leaves it.
 *
 * The wait is `debounced()`'s: coming back within it supersedes it, so
 * nothing flickers and no timer is left to clear. The stylesheet shows the
 * hover content off the attribute, never off `:hover`.
 *
 *     <div class="strip" hoverLinger>…<div class="strip__menu">…</div></div>
 *     .strip[data-hover-linger] .strip__menu { opacity: 1 }
 */
@Directive({
  selector: '[hoverLinger]',
  exportAs: 'hoverLinger',
  host: {
    '(pointerenter)': 'pointer.set(true)',
    '(pointerleave)': 'pointer.set(false)',
    '(focusin)': 'focus.set(true)',
    '(focusout)': 'onFocusOut($event)',
    '[attr.data-hover-linger]': "shown.value() ? '' : null",
  },
})
export class HoverLinger {
  /** How long it lingers, in ms; the bare attribute is the default. */
  readonly hoverLinger = input(HOVER_LINGER, {
    transform: (value: unknown) => numberAttribute(value, HOVER_LINGER),
  });

  protected readonly pointer = signal(false);
  protected readonly focus = signal(false);

  /** The pointer is on the host, or focus is in it — now. */
  readonly active = computed(() => this.pointer() || this.focus());

  /** Shown: at once while active, and for the linger after. */
  readonly shown = debounced(this.active, (active) =>
    active ? undefined : new Promise<void>((resolve) => setTimeout(resolve, this.hoverLinger())),
  );

  /** Focus leaving for another place inside the host is no leaving. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as Node).contains(next)) return;
    this.focus.set(false);
  }
}
