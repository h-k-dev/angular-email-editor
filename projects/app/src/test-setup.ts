import { TestBed } from '@angular/core/testing';
import { beforeEach } from 'vitest';

import { SYSTEM_REGION } from './app/core/translations/region';
import { provideI18n } from './i18n/loader';

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

/**
 * Every spec speaks English, as the app does: templates read their words
 * through ngx-translate's pipe, which needs its service, and English is
 * bundled, so a rendered component shows words, not keys. A spec that
 * configures its own TestBed adds to this.
 */
/**
 * …and lives in Germany, the app's fallback region, whatever machine or
 * time zone runs it: the calendar's week starts on Monday. A spec of
 * another region picks it (`Region.choose`).
 */
beforeEach(() =>
  TestBed.configureTestingModule({
    providers: [provideI18n(), { provide: SYSTEM_REGION, useValue: 'DE' }],
  }),
);

/**
 * Every spec starts on an empty storage: a preference one spec picks (a
 * language, a theme, the toolbar) is kept there, and must not reach the
 * next spec in the file.
 */
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // …and in English, as the page starts: a spec that switched the language
  // leaves `<html lang>` behind.
  document.documentElement.lang = 'en';
});

/**
 * …and on an entry with nothing in it. The runner shares one window between
 * the spec files a worker runs (`isolate: false`, the builder's default), and
 * the history with it: a guard another file left up (core/router/back-button)
 * leaves its mark on the entry the next file starts from — so a spec that
 * presses back onto it would find that mark, not a clean page. How many files
 * share a window is how many workers there are, so it shows on a CI runner's
 * few cores and hardly ever on a laptop's.
 */
beforeEach(() => history.replaceState(null, ''));

/** jsdom implements no scrolling: a chip that scrolls itself into view (the
    chip cloud's arrow keys) finds a no-op instead of throwing. */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    return;
  };
}
