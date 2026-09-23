import { Resource, debounced } from '@angular/core';

// Library
import { TYPING_REST } from 'angular-email-editor';

export interface AtRestOptions<T> {
  /** How long a burst must stop, in ms. Default {@link TYPING_REST}. */
  rest?: number;
  /** Values that pass at once and are no part of any burst — a view's own
      echo coming back to it, which it already shows. */
  passes?: (value: T) => boolean;
}

/**
 * `source`, settled the way typing settles: a change that comes after a
 * rest — a one-shot write, or the first key of a burst — passes at once;
 * the changes of a burst wait until it stops ({@link TYPING_REST}: five of a
 * record typist's keystroke gaps), and only the last of them lands.
 *
 * `debounced()` with a leading edge: signal in, resource out — `value()`
 * holds the last settled value while a burst runs, so the graph stays
 * whole. For work that costs more than a keystroke gap on a large email and
 * must still answer a single write at once. Call in an injection context.
 */
export function atRest<T>(source: () => T, options: AtRestOptions<T> = {}): Resource<T> {
  const rest = options.rest ?? TYPING_REST;
  let lastChange = -Infinity;
  return debounced(source, (value) => {
    if (options.passes?.(value)) return;
    const now = performance.now();
    const quiet = now - lastChange >= rest;
    lastChange = now;
    if (quiet) return;
    return new Promise<void>((resolve) => setTimeout(resolve, rest));
  });
}
