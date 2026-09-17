import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, Signal, computed, debounced, inject } from '@angular/core';

/**
 * The chip's animation state — the part of the motion that CSS alone cannot
 * carry. The stylesheet owns the pictures (the sweep, the fade, the exit,
 * the fill); this file owns the timing they key off, so the two stay in
 * one component and no host has to know a band is moving.
 */

/** How long the scanning band takes to fade once it is told to go, in ms.
    Matches the stylesheet: its exit animation runs this long, and the host
    attribute that keeps the band on the page holds for the same stretch —
    a tab that never paints must still let go of it. */
export const SCAN_EXIT = 300;

/** What the host's `data-scanning` reads: `'true'` while the band sweeps,
    `'leaving'` while it fades out, `null` when there is no band. */
export type ScanningState = 'true' | 'leaving' | null;

/**
 * The scanning band's state: `'true'` while `active()`, then `'leaving'`
 * for `exit` ms after it stops, then nothing. The band's CSS keys off both
 * — the sweep runs while the state is set at all, and `leaving` stacks the
 * exit animation on top — so a number that arrives mid-sweep sees the band
 * fade out on its way rather than vanish wherever it was.
 *
 * The hold is a `debounced` view of `active` that follows it at once on the
 * way up and `exit` ms late on the way down: while the wait runs, the
 * debounced value is still the old `true`, and that is the leaving state.
 * Activity that returns mid-exit supersedes the pending wait, so the band
 * simply carries on. No effect or timer of our own — and no exit on the
 * server, where nothing is painted.
 *
 * Call in an injection context.
 */
export function scanningState(
  active: Signal<boolean>,
  exit: number = SCAN_EXIT,
): Signal<ScanningState> {
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const held = debounced(active, (on) =>
    on || !browser ? undefined : new Promise<void>((resolve) => setTimeout(resolve, exit)),
  );
  return computed(() => (active() ? 'true' : held.value() ? 'leaving' : null));
}

/** The user has asked for less motion: no fake fill, no sweep. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
