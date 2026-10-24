import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../core/translations/i18n';
import { InboxMail, ReceivedMail } from '../../../../core/email/mailbox/received-mail';
import {
  INBOX_LIST_MAX,
  INBOX_LIST_MIN,
  INBOX_READER_MIN,
  Preferences,
} from '../../../../core/storages/preferences';
import { SplitHandle } from '../../../../core/common/directives/split-handle/split-handle';
import { Paper } from '../../../../core/theme/paper';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { PaperIslandDirective } from '../../../partials/shared/email/paper-island';

/** One row of the list, worked out once per language: the message, and
    the date as the list shows it. */
interface InboxRow {
  readonly mail: InboxMail;
  readonly when: string;
}

/**
 * A pretend mail client: the example catalogue's received mail (`ReceivedMail`)
 * — the list, and the open message in a routed pane (`/inbox/:id`, `InboxReader`), where its
 * answers are. On a desk the two stand side by side, the divider between
 * them dragged to taste; on a phone the open message takes the list's
 * place, and the platform's back button brings the list back — one router
 * outlet, laid out per screen, rather than a split squeezed onto a phone.
 *
 * Each half has its header, the two the same height: the list's on the
 * app's surface, the mail's on the reading paper — the whole half is paper,
 * light or dark as its button turns it, whatever the app round it is.
 */
@Component({
  selector: 'app-inbox',
  imports: [
    TranslatePipe,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatIconButton,
    MatIcon,
    SplitHandle,
    PageHeader,
    PaperIslandDirective,
  ],
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
  readonly #mailbox = inject(ReceivedMail);
  readonly #paper = inject(Paper);

  /** The paper the mail's half is read on (`Paper.reading`). */
  protected readonly paper = this.#paper.reading;

  /** What the paper button does: turns the paper the other way. */
  protected readonly paperLabel = computed(() =>
    this.paper() === 'dark' ? 'inbox.paperLight' : 'inbox.paperDark',
  );

  /** The grid the divider resizes: this page. */
  protected readonly grid = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** How wide the list is, px — its divider, dragged; kept across reloads. */
  protected readonly listWidth = inject(Preferences).inboxListWidth;
  protected readonly listMin = INBOX_LIST_MIN;
  protected readonly listMax = INBOX_LIST_MAX;
  /** The open message's least width: the divider stops there. */
  protected readonly readerMin = INBOX_READER_MIN;

  /** Whether a message is open in the pane: on a phone, the pane then
      takes the list's place. */
  protected readonly reading = signal(false);

  /** The list: today's messages by their time, older ones by their day, in
      the app's language; a date the message wrote out itself as it is,
      and none where it has none. */
  protected readonly rows = computed<readonly InboxRow[]>(() => {
    const locale = this.#i18n.lang();
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const today = new Date().toDateString();
    return this.#mailbox.mails().map((mail) => ({
      mail,
      when:
        mail.date instanceof Date
          ? (mail.date.toDateString() === today ? time : day).format(mail.date)
          : (mail.date ?? ''),
    }));
  });

  /** Messages not yet opened, by id. */
  protected readonly unread = this.#mailbox.unread;

  /** The paper button: the mail read on the other paper. */
  protected flipPaper(): void {
    this.#paper.flipReading();
  }

  /** The pane changed: a message opened (read from then on, however it was
      reached — a row, a link, the back button) or the note came back. */
  protected opened(): void {
    const id = this.#route.firstChild?.snapshot.paramMap.get('id') ?? null;
    this.reading.set(id !== null);
    if (id !== null) this.#mailbox.read(id);
  }
}
