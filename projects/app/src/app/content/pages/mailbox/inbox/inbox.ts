import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../core/translations/i18n';
import { INBOX, InboxMail } from '../../../../core/email/mailbox/mails';
import { INBOX_LIST_MAX, INBOX_LIST_MIN, Preferences } from '../../../../core/storages/preferences';
import { SplitHandle } from '../../../../core/common/directives/split-handle/split-handle';

/** One row of the list, worked out once per language: the message, and
    the date as the list shows it. */
interface InboxRow {
  readonly mail: InboxMail;
  readonly when: string;
}

/**
 * A pretend mail client: an inbox of made-up messages — the list, and the
 * open message in a routed pane (`/inbox/:id`, `InboxReader`), where its
 * answers are. On a desk the two stand side by side, the divider between
 * them dragged to taste; on a phone the open message takes the list's
 * place, and the platform's back button brings the list back — one router
 * outlet, laid out per screen, rather than a split squeezed onto a phone.
 */
@Component({
  selector: 'app-inbox',
  imports: [TranslatePipe, RouterLink, RouterLinkActive, RouterOutlet, SplitHandle],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
  host: {
    '[style.--inbox-list-width.px]': 'listWidth()',
    '[attr.data-reading]': 'reading() || null',
  },
})
export class Inbox {
  readonly #i18n = inject(I18n);
  readonly #route = inject(ActivatedRoute);

  /** The grid the divider resizes: this page. */
  protected readonly grid = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** How wide the list is, px — its divider, dragged; kept across reloads. */
  protected readonly listWidth = inject(Preferences).inboxListWidth;
  protected readonly listMin = INBOX_LIST_MIN;
  protected readonly listMax = INBOX_LIST_MAX;

  /** The messages read so far — opening one reads it. */
  readonly #read = signal<ReadonlySet<string>>(new Set());

  /** Whether a message is open in the pane: on a phone, the pane then
      takes the list's place. */
  protected readonly reading = signal(false);

  /** The list: today's messages by their time, older ones by their day, in
      the app's language. */
  protected readonly rows = computed<readonly InboxRow[]>(() => {
    const locale = this.#i18n.lang();
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const today = new Date().toDateString();
    return INBOX.map((mail) => ({
      mail,
      when: (mail.date.toDateString() === today ? time : day).format(mail.date),
    }));
  });

  /** Messages not yet opened, by id. */
  protected readonly unread = computed(
    () =>
      new Set(
        INBOX.filter((mail) => mail.unread && !this.#read().has(mail.id)).map((mail) => mail.id),
      ),
  );

  /** The pane changed: a message opened (read from then on, however it was
      reached — a row, a link, the back button) or the note came back. */
  protected opened(): void {
    const id = this.#route.firstChild?.snapshot.paramMap.get('id') ?? null;
    this.reading.set(id !== null);
    if (id !== null) this.#read.update((read) => new Set(read).add(id));
  }
}
