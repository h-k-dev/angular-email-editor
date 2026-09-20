import { DOCUMENT, Service, inject } from '@angular/core';

/** What a guard hands back: calling it takes the guard down — because what
    it guarded has been closed some other way (a button, a send). */
export type BackRelease = () => void;

/** A guard that is up: the history entry it sits on, and the way to take it
    down. The key is what a thing put back by the forward button hands to
    its next guard ({@link BackGuard.adopt}), so what came back takes over
    the entry it came back on instead of adding another. */
export interface Guarded {
  readonly key: number;
  readonly release: BackRelease;
}

/** What a guard does with the two presses. */
export interface BackGuard {
  /** The back press: close what is guarded. */
  dismiss: () => void;
  /** The forward press, back into this entry: put back what the back press
      closed. A guard without one is spent the moment it is dismissed —
      nothing of it can come back, and the forward press does nothing. */
  restore?: () => void;
  /** The entry to take over instead of adding one: the key the thing being
      guarded came back on. Ignored unless that guard is still the one on
      top — anything else is an ordinary new guard. */
  adopt?: number | null;
}

/** The mark a guard leaves in the history entry it adds, so an entry of
    this app's own is never mistaken for one the page pushed itself. The
    value is the guard's key, which only ever counts up — so the entry the
    browser is on says which guards are still ahead of it. */
const GUARD = '__backGuard';

/** Which life of the page left that mark. A history entry keeps its state
    through a reload — a refresh, a hard refresh, a tab the browser brings
    back — while the guards it named do not: they went with the page, and
    the keys count from 1 again. Without this, a refresh on top of an open
    window would leave its entry claiming key 1, and the next window's own
    key 1 would read as no further ahead than that one — a back press that
    closed nothing, on an entry nothing is on. So every mark says whose it
    is, and a mark from a life that has ended is no mark at all. */
const LIFE = '__backGuardLife';

/** This page life's token — no two loads share one. */
const life = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** One thing the back button would close, and how. `live` goes false when
    the thing closed by itself: the history entry is still there until it is
    rewound or popped, but it has nothing left to close. */
interface Guard {
  readonly key: number;
  dismiss: () => void;
  restore?: () => void;
  live: boolean;
}

/**
 * The phone's back button (and the back gesture, and the browser's own back),
 * as a way out of whatever is open over the page — a compose window, a
 * sheet, a full-screen menu — and the forward button as the way back in.
 *
 * `guard({ dismiss })` adds one history entry and takes the next back press:
 * instead of leaving the page, the press calls `dismiss`. Closing the thing
 * some other way releases the guard, which quietly takes that entry back out
 * of the history, so the back button means what it did before.
 *
 * A guard that also says how to `restore` waits on its entry after the back
 * press instead of being spent: the forward button walks back into it and
 * what was closed comes back. Only a back press leaves a guard there —
 * something closed by hand is closed on purpose, and its entry goes with it.
 * What comes back arms its own guard on that same entry (`adopt`), so a
 * thing closed and brought back all afternoon never grows the history by a
 * single entry.
 *
 * Guards stack, last in first out: with two open, the first back press
 * closes the newer. The URL never changes — only an entry is added — so the
 * router and every link keep working. What the browser lands on decides what
 * closes and what comes back: every guard whose entry the press went past is
 * dismissed, newest first, and every one it walked back into is restored,
 * oldest first — so a press that jumps several entries at once (a long press
 * on the button) takes them all, in order, instead of leaving one behind.
 *
 * Nothing here is phone-only; it is on a phone that it matters, which is
 * where the caller decides to guard (see the compose window).
 */
@Service()
export class BackButton {
  readonly #window = inject(DOCUMENT).defaultView;

  /** The guards that are up, oldest first — one history entry each, in the
      same order. The last one takes the next press. */
  readonly #guards: Guard[] = [];

  /** The guards a back press dismissed that say how to come back, oldest
      first — each still on its own entry, ahead of where the browser now
      is, waiting for the forward button. */
  readonly #spent: Guard[] = [];

  /** This load of the page, which is as long as a guard lives. */
  readonly #life = life();

  #nextKey = 1;
  #listening = false;

  /**
   * Takes the next back press for `dismiss`, as long as the guard is up —
   * and the forward press that walks back into its entry for `restore`.
   * Hands back the entry's key and the release: call the release when the
   * thing closes by itself, and always, because a guard left up would
   * swallow a real back press.
   */
  guard(handlers: BackGuard): Guarded {
    const history = this.#window?.history;
    if (!history) return { key: 0, release: () => {} };
    const adopted = this.#adopt(handlers);
    if (adopted) return adopted;
    const key = this.#nextKey++;
    this.#guards.push({ key, dismiss: handlers.dismiss, restore: handlers.restore, live: true });
    this.#listen();
    // A new entry is the end of the history: everything the forward button
    // could have walked into is gone with it, and so is every guard that
    // was waiting there.
    this.#spent.length = 0;
    // Same URL, one more entry: the page does not navigate, and nothing
    // else on it has to know.
    history.pushState({ ...(history.state ?? {}), [GUARD]: key, [LIFE]: this.#life }, '');
    return { key, release: () => this.#release(key) };
  }

  /** A thing the forward button put back is already on an entry, with its
      guard still standing on it: the new guard takes that one over — the
      entry, and the press it holds — instead of adding a second. Only
      while it is the one on top, which is where the browser is standing;
      anything else (a guard since released, a screen that stopped guarding
      meanwhile) is an ordinary new guard. */
  #adopt({ adopt, dismiss, restore }: BackGuard): Guarded | null {
    if (adopt == null) return null;
    const top = this.#guards.at(-1);
    if (!top || top.key !== adopt || !top.live) return null;
    top.dismiss = dismiss;
    top.restore = restore;
    return { key: top.key, release: () => this.#release(top.key) };
  }

  /** The thing closed some other way. A guard a back press has already
      dismissed is not here to find — it is waiting on its entry for the
      forward button, and the release that comes with its closing is not
      what put it there. */
  #release(key: number): void {
    const guard = this.#guards.find((g) => g.key === key);
    if (!guard) return;
    guard.live = false;
    this.#rewind();
  }

  #listen(): void {
    if (this.#listening || !this.#window) return;
    this.#listening = true;
    this.#window.addEventListener('popstate', () => this.#popped());
  }

  /** The browser has moved. Every guard the entry it landed on is behind —
      the ones the press went past — closes, newest first, and the ones that
      say how to come back stay on their entries for the forward button.
      Then every guard it has walked back into puts its thing back, oldest
      first, and stays on that entry for what comes back to arm again
      (`adopt`). A move this service made itself (`#rewind`) lands past
      nothing and walks into nothing, so it does neither. */
  #popped(): void {
    const at = this.#at();
    while (this.#guards.length && this.#guards[this.#guards.length - 1].key > at) {
      const guard = this.#guards.pop()!;
      if (!guard.live) continue;
      if (guard.restore) this.#spent.unshift(guard);
      guard.dismiss();
    }
    while (this.#spent.length && this.#spent[0].key <= at) {
      const guard = this.#spent.shift()!;
      this.#guards.push(guard);
      guard.restore?.();
    }
  }

  /** Which of this life's guards the entry the browser is on is standing
      on: its key, or none at all — an entry with no mark, one the page
      pushed itself, or one a life of this page before the last reload left
      behind, all of which have nothing of ours open on them. */
  #at(): number {
    const state = this.#window?.history.state;
    if (state?.[LIFE] !== this.#life) return 0;
    return (state[GUARD] as number | undefined) ?? 0;
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
