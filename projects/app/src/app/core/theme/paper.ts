import { Service, computed, inject } from '@angular/core';

import type { PaperScheme } from '../dawn/dawn.render';
import { Preferences } from '../storages/preferences';
import { Theme } from './theme';

/**
 * The paper's scheme, one answer for everything that shows an email: the
 * settings' Theme (`editorAppearance` — Light, Dark, or Auto: the app's
 * own), resolved. Every composer writes on it; a view that reads mail
 * starts from it (the inbox's `InboxPaper` turns it at will).
 */
@Service()
export class Paper {
  readonly #appearance = inject(Preferences).editorAppearance;
  readonly #theme = inject(Theme);

  readonly scheme = computed<PaperScheme>(() => {
    const appearance = this.#appearance();
    return appearance === 'auto' ? this.#theme.scheme() : appearance;
  });

  /** The other paper, kept as the settings' Theme — Auto included: a
      press means this one, not the app's any more. */
  toggle(): void {
    this.#appearance.set(this.scheme() === 'dark' ? 'light' : 'dark');
  }
}
