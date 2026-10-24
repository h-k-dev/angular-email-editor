import { Service, computed, inject, linkedSignal } from '@angular/core';

import type { PaperScheme } from '../render/render';
import { Preferences } from '../storages/preferences';
import { Theme } from './theme';

/**
 * The paper's scheme, one answer for everything that shows an email: the
 * settings' Theme (`editorAppearance` — Light, Dark, or Auto: the app's
 * own), resolved. Every composer writes on it; the inbox reads on it.
 */
@Service()
export class Paper {
  readonly #appearance = inject(Preferences).editorAppearance;
  readonly #theme = inject(Theme);

  readonly scheme = computed<PaperScheme>(() => {
    const appearance = this.#appearance();
    return appearance === 'auto' ? this.#theme.scheme() : appearance;
  });

  /** The paper an email is read on: the editor's to start with, and the
      reader's own once its button turns it (Thunderbird's: a message is
      read light or dark at will, whatever the app round it is) — back to
      the editor's whenever that one changes. */
  readonly reading = linkedSignal<PaperScheme>(() => this.scheme());

  /** The reader's button: light paper to dark, dark to light. */
  flipReading(): void {
    this.reading.update((scheme) => (scheme === 'dark' ? 'light' : 'dark'));
  }
}
