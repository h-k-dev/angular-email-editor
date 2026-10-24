import { Component, inject } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { TranslatePipe } from '@ngx-translate/core';

import { MailboxAside } from './mailbox-aside';

/**
 * A phone's shut aside opens from here: the first thing in every page's
 * header (`PAGE_HEADER_LEAD`, the mailbox lends it), top left where the
 * aside's own toggle stands — part of the header, so it scrolls away with a
 * header that scrolls away (the mail's), and stays with one that stays (the
 * list's). Nothing at all on a desk, or while the aside is open.
 */
@Component({
  selector: 'mailbox-opener',
  imports: [TranslatePipe, MatIconButton, MatIcon],
  template: `
    @if (closed()) {
      <button
        matIconButton
        type="button"
        class="mailbox-opener"
        aria-controls="mailbox-aside"
        aria-expanded="false"
        [attr.aria-label]="'app.nav.expand' | translate"
        [title]="'app.nav.expand' | translate"
        (click)="open()"
      >
        <mat-icon>left_panel_open</mat-icon>
      </button>
    }
  `,
  // No box of its own: the button is the header row's item — and with no
  // button, nothing is there to take a gap.
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class MailboxOpener {
  readonly #aside = inject(MailboxAside);

  protected readonly closed = this.#aside.closed;

  protected open(): void {
    this.#aside.toggle();
  }
}
