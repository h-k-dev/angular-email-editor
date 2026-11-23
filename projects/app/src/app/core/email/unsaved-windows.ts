import {
  DOCUMENT,
  EnvironmentProviders,
  inject,
  provideEnvironmentInitializer,

  // Signals
  effect,
} from '@angular/core';

import { ComposeWindows } from './compose-windows';

/**
 * Asks before the page unloads — a reload, the tab closing — while any
 * window is on the edge or its stack (`ComposeWindows.windows`): the windows
 * live for the page, and nothing of them is kept past it. Whether one has
 * anything written in it is not asked — a window still there is a window
 * someone means to come back to. The browser's own prompt: its words are
 * not the app's to set.
 *
 * The listener is there only while a window is: a page that always listens
 * for `beforeunload` is never kept in the back/forward cache.
 *
 * A host with its own exit confirmation (a router guard that asks before a
 * page holding windows is left) reads `ComposeWindows.windows` there
 * instead, and leaves this out.
 */
export function provideUnsavedWindowsWarning(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const windows = inject(ComposeWindows);
    const view = inject(DOCUMENT).defaultView;
    const warn = (event: BeforeUnloadEvent) => {
      // Effects run a beat late: ask at the moment itself.
      if (!windows.windows().length) return;
      event.preventDefault();
      // Engines that predate preventDefault() here.
      event.returnValue = true;
    };

    effect((onCleanup) => {
      if (!view || !windows.windows().length) return;
      view.addEventListener('beforeunload', warn);
      onCleanup(() => view.removeEventListener('beforeunload', warn));
    });
  });
}
