import {
  DOCUMENT,
  DestroyRef,
  Service,
  inject,

  // Signals
  WritableSignal,
  linkedSignal,
  signal,
} from '@angular/core';

/**
 * The browser's localStorage as signals, one per key: `pairSignal(key)`
 * reads what the key holds and writes through to it, and every tab of the
 * app sees the change. Another tab's write arrives as a `storage` event —
 * which the browser never sends to the tab that wrote, so this tab's own
 * writes update the signal directly.
 *
 * Values are the raw strings storage holds. Parsing is the caller's: a
 * string compares by value, so an unchanged write is recognisable as one
 * (and the browser sends no event for it either).
 *
 * Where storage cannot be used — disabled, a private mode that throws — the
 * signals still work, in memory, for this tab alone.
 */
@Service()
export class LocalStorage {
  readonly #window = inject(DOCUMENT).defaultView;
  readonly #storage = openStorage(this.#window);
  /** What each key holds, as this tab last saw it. */
  readonly #entries = new Map<string, WritableSignal<string | null>>();
  /** The signal handed out per key — the same one to every caller. */
  readonly #pairs = new Map<string, WritableSignal<string | null>>();

  constructor() {
    const window = this.#window;
    if (!window) return;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== this.#storage) return;
      // A null key is another tab's clear(): every key may have changed.
      if (event.key === null) {
        for (const [key, entry] of this.#entries) entry.set(this.#read(key));
        return;
      }
      this.#entries.get(event.key)?.set(event.newValue);
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  /** The key's value as a signal: `null` while the key is not set. Setting
      it writes to storage — `null` removes the key. A write storage refuses
      (the quota) leaves the signal on what storage still holds; use
      {@link setItem} to hear about it. */
  pairSignal(key: string): WritableSignal<string | null> {
    let pair = this.#pairs.get(key);
    if (!pair) {
      pair = linkedSignal<string | null, string | null>({
        source: this.#entry(key),
        computation: (value) => value,
        set: (value) => void this.setItem(key, value),
      });
      this.#pairs.set(key, pair);
    }
    return pair;
  }

  /** Writes the key (`null` removes it) and reports whether storage took
      it. Without storage the value is kept in memory, and this reports
      `false`: nothing outlives the tab. */
  setItem(key: string, value: string | null): boolean {
    const entry = this.#entry(key);
    const storage = this.#storage;
    if (!storage) {
      entry.set(value);
      return false;
    }
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      return false;
    }
    entry.set(value);
    return true;
  }

  #entry(key: string): WritableSignal<string | null> {
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = signal(this.#read(key));
      this.#entries.set(key, entry);
    }
    return entry;
  }

  #read(key: string): string | null {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}

/** The window's localStorage, if it can be written: merely touching the
    property throws where storage is disabled, and some private modes only
    throw on the first write. */
function openStorage(window: Window | null): Storage | null {
  try {
    const storage = window?.localStorage;
    if (!storage) return null;
    const probe = '__storage_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
