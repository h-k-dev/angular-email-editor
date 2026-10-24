import { DOCUMENT, DestroyRef, Service, computed, inject, signal } from '@angular/core';

import { Preferences, ThemePreference } from '../storages/preferences';

/** The app's light or dark. */
export type ThemeScheme = 'light' | 'dark';

/** The app's theme, app-wide: the shell's top-bar toggle chooses it, and whatever follows the app (an editor set to
    `auto`) reads it. The choice is a {@link Preferences} one — this browser
    keeps it, in every tab. `system`, the default, is the OS's light or dark,
    followed as it changes; the toggle picks a scheme of the app's own. */
@Service()
export class Theme {
  readonly #document = inject(DOCUMENT);
  readonly #preferences = inject(Preferences);
  readonly #query = this.#document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');

  /** The OS's light or dark, as it changes. */
  readonly #system = signal<ThemeScheme>(this.#query?.matches ? 'dark' : 'light');

  /** What was chosen: light, dark, or the system's. */
  readonly preference = this.#preferences.theme.asReadonly();

  /** The scheme in effect. */
  readonly scheme = computed<ThemeScheme>(() => {
    const preference = this.preference();
    return preference === 'system' ? this.#system() : preference;
  });

  constructor() {
    const query = this.#query;
    if (query) {
      const onChange = (event: MediaQueryListEvent) =>
        this.#system.set(event.matches ? 'dark' : 'light');
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
  }

  /** Light to dark and back — the top bar's toggle: a scheme of the app's
      own from then on, whatever the system does. */
  toggle(): void {
    this.choose(this.scheme() === 'light' ? 'dark' : 'light');
  }

  /** Chooses the theme, as one view transition where the browser has them
      and the scheme changes. */
  choose(preference: ThemePreference): void {
    const before = this.scheme();
    const apply = () => this.#preferences.theme.set(preference);
    const after = preference === 'system' ? this.#system() : preference;
    if (after !== before && this.#document.startViewTransition) {
      this.#document.startViewTransition(apply);
      return;
    }
    apply();
  }
}
