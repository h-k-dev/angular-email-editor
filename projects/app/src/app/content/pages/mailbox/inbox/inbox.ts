import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';

import { filter } from 'rxjs';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../core/translations/i18n';
import { Viewport } from '../../../../core/layout/viewport';
import {
  InboxHeader,
  MailPlace,
  ReceivedMail,
} from '../../../../core/email/mailbox/received-mail';
import {
  INBOX_LIST_MAX,
  INBOX_LIST_MIN,
  INBOX_READER_MIN,
  Preferences,
} from '../../../../core/storages/preferences';
import { Avatar } from '../../../partials/common/avatar/avatar';
import { HueOf } from '../../../partials/common/hue-of/hue-of';
import { SplitHandle } from '../../../partials/common/split-handle/split-handle';
import { InboxPaper } from '../../../partials/atomic/inbox/inbox-paper';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { PaperIslandDirective } from '../../../partials/shared/email/paper-island';

/** One row of the list: the message, the date as the list shows it, and
    where it stands — read, starred, picked. */
interface InboxRow {
  readonly mail: InboxHeader;
  readonly when: string;
  readonly unread: boolean;
  readonly starred: boolean;
  /** Its checkbox, ticked. */
  readonly picked: boolean;
}

/** What the snackbar says once a message has moved out. */
const MOVED: Record<MailPlace, string> = {
  trash: 'inbox.moved.trash',
  archive: 'inbox.moved.archive',
  snoozed: 'inbox.moved.snoozed',
};

/** When it was sent, for the list: a date the message wrote out itself
    ("Aug 18, 2026, 4:32 PM") read as the date it names, so it shows as
    short as the rest — one no date can be read from stays as written. The
    reader and the quote keep it as the message wrote it. */
function sent(date: InboxHeader['date']): Date | string {
  if (date === undefined || date instanceof Date) return date ?? '';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed;
}

/**
 * A pretend mail client: the example catalogue's received mail (`ReceivedMail`)
 * — the list, and the open message in a routed pane (`/inbox/:id`, `InboxReader`), where its
 * answers are. Gmail's way: the list is headers only; a message's body is
 * fetched when its path is opened, or as its row is pointed at. On a desk the two stand side by side, the divider between
 * them dragged to taste; on a phone the open message takes the list's
 * place, and the platform's back button brings the list back — one router
 * outlet, laid out per screen, rather than a split squeezed onto a phone.
 *
 * Each half has its header, the two the same height: the list's on the
 * app's surface, the mail's on the reading paper (`InboxPaper`) — the whole
 * half is paper, light or dark as the reader's button turns it, whatever the
 * app round it is.
 */
@Component({
  selector: 'app-inbox',
  imports: [
    TranslatePipe,
    Avatar,
    HueOf,
    MatCheckbox,
    MatIcon,
    MatIconButton,
    MatTooltip,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    SplitHandle,
    PageHeader,
    PaperIslandDirective,
  ],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
  // The paper the mail is read on: this page's, shared with the reader it
  // routes to (which turns it).
  providers: [InboxPaper],
  host: {
    '[style.--inbox-list-width.px]': 'listWidth()',
    '[attr.data-reading]': 'reading() || null',
  },
})
export class Inbox {
  readonly #i18n = inject(I18n);
  readonly #route = inject(ActivatedRoute);
  readonly #mailbox = inject(ReceivedMail);
  readonly #router = inject(Router);
  readonly #snackBar = inject(MatSnackBar);
  readonly #viewport = inject(Viewport);

  /** The paper the mail's half is read on (`InboxPaper`): the reader's
      button turns it. */
  protected readonly paper = inject(InboxPaper).scheme;

  /** The grid the divider resizes: this page. */
  protected readonly grid = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** How wide the list is, px — its divider, dragged; kept across reloads. */
  protected readonly listWidth = inject(Preferences).inboxListWidth;
  protected readonly listMin = INBOX_LIST_MIN;
  protected readonly listMax = INBOX_LIST_MAX;
  /** The open message's least width: the divider stops there. */
  protected readonly readerMin = INBOX_READER_MIN;

  /** The mail's half: it scrolls, its header with it. */
  protected readonly pane = viewChild<ElementRef<HTMLElement>>('pane');

  /** The message open in the pane, by id, or none. */
  readonly #open = signal<string | null>(null);

  /** Whether a message is open in the pane: on a phone, the pane then
      takes the list's place. */
  protected readonly reading = computed(() => this.#open() !== null);

  /** The mail's header leads with the way back to the list: on a phone,
      where the open message is a page of its own and the list a jump away.
      On a desk the list stands beside it. */
  protected readonly backButton = computed(() => this.#viewport.compact() && this.reading());

  /** The rows ticked, by id — for show, for now: nothing acts on them. */
  readonly #picked = signal<ReadonlySet<string>>(new Set());

  /** The list: today's messages by their time, older ones by their day, in
      the app's language; a date the message wrote out itself as it is,
      and none where it has none. */
  protected readonly rows = computed<readonly InboxRow[]>(() => {
    const locale = this.#i18n.lang();
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const today = new Date().toDateString();
    const unread = this.#mailbox.unread();
    const starred = this.#mailbox.starred();
    const picked = this.#picked();
    return this.#mailbox.inbox().map((mail) => {
      const date = sent(mail.date);
      return {
        mail,
        when:
          date instanceof Date
            ? (date.toDateString() === today ? time : day).format(date)
            : date,
        unread: unread.has(mail.id),
        starred: starred.has(mail.id),
        picked: picked.has(mail.id),
      };
    });
  });

  /** A row's checkbox, ticked or not. */
  protected pick(id: string): void {
    this.#picked.update((picked) => {
      const next = new Set(picked);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Read ⇄ unread. */
  protected toggleRead(row: InboxRow): void {
    if (row.unread) this.#mailbox.read(row.mail.id);
    else this.#mailbox.markUnread(row.mail.id);
  }

  protected toggleStar(id: string): void {
    this.#mailbox.toggleStar(id);
  }

  /** Back to the list: the open message closed, the inbox's own path. */
  protected back(): void {
    void this.#router.navigate(['.'], { relativeTo: this.#route });
  }

  /** Out of the inbox — the trash, the archive, snoozed — with a moment to
      take it back. The open message moved out closes with it. */
  protected move(id: string, place: MailPlace): void {
    this.#mailbox.move(id, place);
    if (this.#open() === id) void this.#router.navigate(['.'], { relativeTo: this.#route });
    this.#snackBar
      .open(this.#i18n.t(MOVED[place]), this.#i18n.t('inbox.undo'), { duration: 4000 })
      .onAction()
      .subscribe(() => this.#mailbox.restore(id));
  }

  /** A row pointed at or focused: Gmail's head start — its body fetched
      before the click, so the message opens at once. */
  protected prefetch(id: string): void {
    this.#mailbox.prefetch(id);
  }

  constructor() {
    // The navigation that made this page: over before it could listen —
    // a link straight to a message opens it all the same.
    this.#opened();
    // Every navigation that ends here, not only the outlet's: from one
    // message to the next the router keeps the reader and only its `:id`
    // changes, so the outlet activates nothing.
    this.#router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.#opened());
  }

  /** The pane changed: a message opened (read from then on, however it was
      reached — a row, a link, the back button) or the note came back. */
  #opened(): void {
    // The pane scrolls as one, header and all: each message starts at its top.
    const pane = this.pane()?.nativeElement;
    if (pane) pane.scrollTop = 0;
    const id = this.#route.snapshot.firstChild?.paramMap.get('id') ?? null;
    this.#open.set(id);
    if (id !== null) this.#mailbox.read(id);
  }
}
