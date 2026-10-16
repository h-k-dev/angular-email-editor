import { DOCUMENT, DestroyRef, Service, inject, signal } from '@angular/core';

/** The app's light or dark. */
export type ThemeScheme = 'light' | 'dark';

/** The app's theme, app-wide: the shell's top-bar toggle switches it, and
    whatever follows the app (an editor set to `app`) reads it. Starts at the
    system preference and follows the OS while the user has not chosen — a
    toggle overrides it, and the next OS change overrides it back, which is
    what a demo shell should do (nothing here is persisted). */
@Service()
export class Theme {
  readonly #document = inject(DOCUMENT);
  readonly #query = this.#document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');

  readonly #scheme = signal<ThemeScheme>(this.#query?.matches ? 'dark' : 'light');
  readonly scheme = this.#scheme.asReadonly();

  constructor() {
    const query = this.#query;
    if (query) {
      const onChange = (event: MediaQueryListEvent) =>
        this.#scheme.set(event.matches ? 'dark' : 'light');
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
  }

  /** Light to dark and back, as one view transition where the browser has
      them. */
  toggle(): void {
    const flip = () => this.#scheme.update((scheme) => (scheme === 'light' ? 'dark' : 'light'));
    if (this.#document.startViewTransition) {
      this.#document.startViewTransition(flip);
      return;
    }
    flip();
  }
}
