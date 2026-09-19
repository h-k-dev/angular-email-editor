import { DOCUMENT, Service, inject } from '@angular/core';

/** What a guard hands back: calling it takes the guard down — because what
    it guarded has been closed some other way (a button, a send). */
export type BackRelease = () => void;

/** The mark a guard leaves in the history entry it adds, so an entry of
    this app's own is never mistaken for one the page pushed itself. The
    value is the guard's key, which only ever counts up — so the entry the
    browser is on says which guards are still ahead of it. */
const GUARD = '__backGuard';

/** One thing the back button would close, and how. `live` goes false when
    the thing closed by itself: the history entry is still there until it is
    rewound or popped, but it has nothing left to close. */
interface Guard {
  readonly key: number;
  readonly dismiss: () => void;
  live: boolean;
}

/**
 * The phone's back button (and the back gesture, and the browser's own back),
 * as a way out of whatever is open over the page — a compose window, a
 * sheet, a full-screen menu.
 *
 * `guard(dismiss)` adds one history entry and takes the next back press:
 * instead of leaving the page, the press calls `dismiss`. Closing the thing
 * some other way releases the guard, which quietly takes that entry back out
 * of the history, so the back button means what it did before.
 *
 * Guards stack, last in first out: with two open, the first back press
 * closes the newer. The URL never changes — only an entry is added — so the
 * router and every link keep working. What the browser lands on decides what
 * closes: every guard whose entry the back press went past is dismissed, so
 * a press that jumps several entries back (a long press on the button) closes
 * all of them, in order, instead of leaving one behind.
 *
 * Nothing here is phone-only; it is on a phone that it matters, which is
 * where the caller decides to guard (see the compose window).
 */
@Service()
export class BackButton {
  readonly #window = inject(DOCUMENT).defaultView;

  /** The guards, oldest first — one history entry each, in the same order.
      The last one takes the next press. */
  readonly #guards: Guard[] = [];
  #nextKey = 1;
  #listening = false;

  /**
   * Takes the next back press for `dismiss`, as long as the guard is up.
   * Returns the release — call it when the thing closes by itself, and
   * always: a guard left up would swallow a real back press.
   */
  guard(dismiss: () => void): BackRelease {
    const history = this.#window?.history;
    if (!history) return () => {};
    const key = this.#nextKey++;
    this.#guards.push({ key, dismiss, live: true });
    this.#listen();
    // Same URL, one more entry: the page does not navigate, and nothing
    // else on it has to know.
    history.pushState({ ...(history.state ?? {}), [GUARD]: key }, '');
    return () => {
      const guard = this.#guards.find((g) => g.key === key);
      if (!guard) return;
      guard.live = false;
      this.#rewind();
    };
  }

  #listen(): void {
    if (this.#listening || !this.#window) return;
    this.#listening = true;
    this.#window.addEventListener('popstate', () => this.#popped());
  }

  /** The browser has moved: every guard the entry it landed on is behind —
      the ones it went past — closes, newest first. A move this service made
      itself (`#rewind`) lands past nothing, so it closes nothing. */
  #popped(): void {
    const at = (this.#window?.history.state?.[GUARD] as number | undefined) ?? 0;
    while (this.#guards.length && this.#guards[this.#guards.length - 1].key > at) {
      const guard = this.#guards.pop()!;
      if (guard.live) guard.dismiss();
    }
  }

  /** Takes the spent entries off the end of the history: a guard released
      while it is the last one leaves nothing behind, and one released out of
      order goes as soon as the guards above it have. */
  #rewind(): void {
    while (this.#guards.length && !this.#guards[this.#guards.length - 1].live) {
      this.#guards.pop();
      this.#window?.history.back();
    }
  }
}
