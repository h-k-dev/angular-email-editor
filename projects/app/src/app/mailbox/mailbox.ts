import { Component, inject } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../services/compose-windows';
import { INBOX } from '../inbox/mails';
import { LanguageMenu } from '../language-menu/language-menu';
import { ThemeToggle } from '../theme-toggle/theme-toggle';

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
 * a quiet aside the viewport's height down the left (the app and Compose
 * on top, the places — small rows, a heading per run, the place you are in
 * a wash, never a bar — and the settings at its foot), and the page itself
 * beside it on a sheet of its own. No bar across the top: the page has the
 * viewport. The composer is not in here: it is the front page, with chrome
 * of its own; the aside leads back to it.
 */
@Component({
  selector: 'app-mailbox',
  imports: [
    TranslatePipe,
    MatIcon,
    MatIconButton,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    LanguageMenu,
    ThemeToggle,
  ],
  templateUrl: './mailbox.html',
  styleUrl: './mailbox.scss',
})
export class Mailbox {
  readonly #composeWindows = inject(ComposeWindows);

  /** Compose: a new message in a window, over the page. */
  protected compose(): void {
    void this.#composeWindows.open();
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
