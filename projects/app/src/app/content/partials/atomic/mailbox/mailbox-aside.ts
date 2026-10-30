import { Service, computed, inject, linkedSignal } from '@angular/core';

import { Viewport } from '../../../../core/layout/viewport';
import { Preferences } from '../../../../core/storages/preferences';

/**
 * The mailbox's aside, open or not — the mailbox page's (listed in its
 * providers), shared with what it lends its pages: the opener in a phone's
 * page headers (`MailboxOpener`).
 */
@Service({ autoProvided: false })
export class MailboxAside {
  readonly #viewport = inject(Viewport);
  readonly #saved = inject(Preferences).asideCollapsed;

  /** Whether the aside is the rail. On a desk, as it was left — the choice
      kept across reloads and tabs (`Preferences.asideCollapsed`); on a
      phone, shut — and back to that whenever the screen crosses the
      breakpoint: state that resets with its sources, not an effect writing
      into a signal. A phone's opening is a moment's, never saved. */
  readonly collapsed = linkedSignal<{ compact: boolean; saved: boolean }, boolean>({
    source: () => ({ compact: this.#viewport.compact(), saved: this.#saved() }),
    computation: ({ compact, saved }) => compact || saved,
    set: (collapsed, rawSet) => {
      rawSet(collapsed);
      if (!this.#viewport.compact()) this.#saved.set(collapsed);
    },
  });

  /** A phone's aside, opened: it lies over the page, under a scrim. */
  readonly over = computed(() => this.#viewport.compact() && !this.collapsed());

  /** A phone's aside, shut: no rail — it is not there at all, and the
      page has the screen; the opener in the page's header opens it. */
  readonly closed = computed(() => this.#viewport.compact() && this.collapsed());

  /** Aside ⇄ rail. */
  toggle(): void {
    this.collapsed.update((collapsed) => !collapsed);
  }
}
