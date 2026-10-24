import { Component, computed, inject, linkedSignal } from '@angular/core';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../core/email/compose-windows';
import { Viewport } from '../../../core/layout/viewport';
import { INBOX } from '../../../core/email/mailbox/mails';
import { LanguageMenu } from '../../partials/common/language-menu/language-menu';
import { ThemeToggle } from '../../partials/common/theme-toggle/theme-toggle';

/** A place the aside leads to. */
interface MailboxLink {
  readonly path: string;
  readonly icon: string;
  readonly key: string;
  /** What waits there, counted — the inbox's unread — or nothing to say. */
  readonly count?: number;
}

/** A run of links under a heading of its own, or none (the first). */
interface MailboxSection {
  readonly id: string;
  readonly key: string | null;
  readonly links: readonly MailboxLink[];
}

/**
 * The mailbox: the app's pages as a mail client lays them out, Linear's —
 * a quiet aside the viewport's height down the left (the rail toggle and
 * Compose on top, the places — small rows, a heading per run, the place you
 * are in a wash, never a bar — and the settings at its foot), and the page
 * itself beside it on a sheet of its own. No bar across the top: the page
 * has the viewport. The composer is not in here: it is the front page, with
 * chrome of its own; the aside leads back to it.
 *
 * Collapsed, the aside is a rail of its icons — at once, no motion. On a
 * phone the rail is where it rests; opened there, it lies over the page.
 */
@Component({
  selector: 'app-mailbox',
  imports: [
    TranslatePipe,
    MatIcon,
    MatButton,
    MatIconButton,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    LanguageMenu,
    ThemeToggle,
  ],
  templateUrl: './mailbox.html',
  styleUrl: './mailbox.scss',
  host: {
    '[attr.data-collapsed]': 'collapsed() || null',
    '[attr.data-over]': 'over() || null',
    '(keydown.escape)': 'close($event)',
  },
})
export class Mailbox {
  readonly #composeWindows = inject(ComposeWindows);
  readonly #viewport = inject(Viewport);

  /** Whether the aside is the rail. Open on a desk, the rail on a phone —
      and back to that whenever the screen crosses the breakpoint: state
      that resets with its source, not an effect writing into a signal. */
  readonly collapsed = linkedSignal(() => this.#viewport.compact());

  /** A phone's aside, opened: it lies over the page, under a scrim. */
  protected readonly over = computed(() => this.#viewport.compact() && !this.collapsed());

  /** The toggle: aside ⇄ rail. */
  protected toggle(): void {
    this.collapsed.update((collapsed) => !collapsed);
  }

  /** Compose: a new message in a window, over the page. */
  protected compose(): void {
    this.went();
    void this.#composeWindows.open();
  }

  /** A place was picked (or Compose pressed): an aside lying over the page
      has done its job and steps back to the rail. */
  protected went(): void {
    if (this.over()) this.collapsed.set(true);
  }

  /** Escape closes an aside that lies over the page — unless something
      inside took the key first (the language menu closing). */
  protected close(event: Event): void {
    if (!this.over() || event.defaultPrevented) return;
    event.preventDefault();
    this.collapsed.set(true);
  }

  /** The aside, in reading order: the mail, then the reference pages. */
  protected readonly sections: readonly MailboxSection[] = [
    {
      id: 'mail',
      key: null,
      links: [
        { path: '/', icon: 'edit_note', key: 'app.nav.composer' },
        {
          path: '/inbox',
          icon: 'inbox',
          key: 'app.nav.inbox',
          count: INBOX.filter((mail) => mail.unread).length,
        },
      ],
    },
    {
      id: 'developers',
      key: 'app.nav.developers',
      links: [
        { path: '/api', icon: 'api', key: 'app.nav.api' },
        { path: '/styling', icon: 'palette', key: 'app.nav.styling' },
        { path: '/render', icon: 'compare', key: 'app.nav.render' },
      ],
    },
  ];
}
