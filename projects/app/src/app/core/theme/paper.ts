import { Service, computed, inject } from '@angular/core';

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
}
