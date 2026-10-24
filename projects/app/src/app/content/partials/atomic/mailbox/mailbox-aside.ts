import { Service, computed, inject, linkedSignal } from '@angular/core';

import { Viewport } from '../../../../core/layout/viewport';

/**
 * The mailbox's aside, open or not — the mailbox page's (listed in its
 * providers), shared with what it lends its pages: the opener in a phone's
 * page headers (`MailboxOpener`).
 */
@Service({ autoProvided: false })
export class MailboxAside {
  readonly #viewport = inject(Viewport);

  /** Whether the aside is the rail. Open on a desk, the rail on a phone —
      and back to that whenever the screen crosses the breakpoint: state
      that resets with its source, not an effect writing into a signal. */
  readonly collapsed = linkedSignal(() => this.#viewport.compact());

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
