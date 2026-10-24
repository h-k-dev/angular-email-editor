import { Service, inject, linkedSignal } from '@angular/core';

import type { PaperScheme } from '../../../../core/dawn/dawn.render';
import { Paper } from '../../../../core/theme/paper';

/**
 * The paper the inbox reads mail on — the inbox page's own state, shared
 * with the message it holds: the page (`Inbox`) provides it and lays the
 * mail's half on it, the routed reader (`InboxReader`, through the outlet's
 * injector) turns it with its button. A routed child has no template to
 * bind an output to, so this is how the two agree.
 *
 * The editor's paper to start with (`Paper`), either at will after —
 * Thunderbird's: a message read light or dark whatever the app round it
 * is — and back to the editor's whenever that one changes.
 */
@Service({ autoProvided: false })
export class InboxPaper {
  readonly #editor = inject(Paper).scheme;

  readonly scheme = linkedSignal<PaperScheme>(() => this.#editor());

  /** Light paper to dark, dark to light. */
  flip(): void {
    this.scheme.update((scheme) => (scheme === 'dark' ? 'light' : 'dark'));
  }
}
