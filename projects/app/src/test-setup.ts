/**
 * Node 26 ships Web Storage of its own: `localStorage` and `sessionStorage`
 * globals that are `undefined` unless Node was started with a storage file.
 * They sit on the global object before the test DOM is installed, so jsdom's
 * working storage never replaces them — and the app's draft, which lives in
 * localStorage, would be tested against nothing (the LocalStorage service
 * falls back to memory, and no `storage` event could ever be dispatched).
 *
 * The runner exposes the jsdom instance: take its storage, whose `storage`
 * events and `StorageEvent.storageArea` are jsdom's own. Only when missing,
 * so a Node or runner that gets this right wins.
 */
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (dom && !globalThis[name]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      get: () => dom.window[name],
    });
  }
}
