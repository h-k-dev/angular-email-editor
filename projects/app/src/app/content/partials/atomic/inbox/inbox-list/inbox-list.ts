import { Component, computed, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import { I18n } from '../../../../../core/translations/i18n';
import {
  InboxHeader,
  MailPlace,
  ReceivedMail,
} from '../../../../../core/email/mailbox/received-mail';
import { Avatar } from '../../../common/avatar/avatar';
import { Grid, GridCell, GridRow, GridWidget } from '../../../common/grid/grid';
import { HueOf } from '../../../common/hue-of/hue-of';

/** One row of the list: the message, the date as the list shows it, and
    where it stands — read, starred, picked, open. */
interface InboxRow {
  readonly mail: InboxHeader;
  readonly when: string;
  readonly unread: boolean;
  readonly starred: boolean;
  /** Its checkbox, ticked. */
  readonly picked: boolean;
  /** Open in the pane. */
  readonly open: boolean;
}

/** A run of rows under a title of its own: the messages brought in by hand
    (an `.eml` dropped, a raw message pasted), or the catalogue's. */
interface InboxSection {
  readonly id: 'imported' | 'mail';
  readonly label: string;
  readonly rows: readonly InboxRow[];
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
 * The inbox's list (`ReceivedMail`) — the imported section on top, then the
 * catalogue's (Gmail's Priority Inbox sections) — Proton's rows on a `grid` — Gmail's
 * keyboard: one tab stop, ↑ ↓ the rows, Enter opens, Space ticks, → to a
 * row's checkbox and quick actions. A row still links to its message
 * (`/inbox/:id`) for the pointer: a click, a middle click, a copied link.
 *
 * The rows' state is ARIA, and the stylesheet reads it: the open one is
 * `aria-current="page"`, a ticked one `aria-selected="true"`.
 */
@Component({
  selector: 'app-inbox-list',
  imports: [
    TranslatePipe,
    Avatar,
    GridCell,
    GridRow,
    GridWidget,
    HueOf,
    MatCheckbox,
    MatIcon,
    MatIconButton,
    MatTooltip,
    RouterLink,
  ],
  templateUrl: './inbox-list.html',
  styleUrl: './inbox-list.scss',
  // The list is the grid: its rows are the template's own.
  hostDirectives: [Grid],
  host: { '[attr.aria-label]': 'label()' },
})
export class InboxList {
  readonly #i18n = inject(I18n);
  readonly #mailbox = inject(ReceivedMail);
  readonly #route = inject(ActivatedRoute);
  readonly #router = inject(Router);
  readonly #snackBar = inject(MatSnackBar);

  /** The message open in the pane, by id, or none. */
  readonly open = input<string | null>(null);

  protected readonly label = computed(() => this.#i18n.t('inbox.title'));

  /** The rows ticked, by id — for show, for now: nothing acts on them. */
  readonly #picked = signal<ReadonlySet<string>>(new Set());

  /** The list, a section at a time: the messages brought in on top, then
      the catalogue's. Today's messages by their time, older ones by their
      day, in the app's language; a date the message wrote out itself as it
      is, and none where it has none. */
  protected readonly sections = computed<readonly InboxSection[]>(() => {
    const locale = this.#i18n.lang();
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const today = new Date().toDateString();
    const unread = this.#mailbox.unread();
    const starred = this.#mailbox.starred();
    const picked = this.#picked();
    const open = this.open();
    const row = (mail: InboxHeader): InboxRow => {
      const date = sent(mail.date);
      return {
        mail,
        when:
          date instanceof Date ? (date.toDateString() === today ? time : day).format(date) : date,
        unread: unread.has(mail.id),
        starred: starred.has(mail.id),
        picked: picked.has(mail.id),
        open: mail.id === open,
      };
    };
    return [
      {
        id: 'imported',
        label: this.#i18n.t('inbox.import.title'),
        rows: this.#mailbox.imported().map(row),
      },
      {
        id: 'mail',
        label: this.#i18n.t('inbox.import.rest'),
        rows: this.#mailbox.inbox().map(row),
      },
    ];
  });

  /** A row's checkbox, ticked or not — or Space on the row. */
  protected pick(id: string): void {
    this.#picked.update((picked) => {
      const next = new Set(picked);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Enter on a row: its message, open — as its link would. */
  protected openMail(id: string): void {
    void this.#router.navigate([id], { relativeTo: this.#route });
  }

  /** Read ⇄ unread. */
  protected toggleRead(row: InboxRow): void {
    if (row.unread) this.#mailbox.read(row.mail.id);
    else this.#mailbox.markUnread(row.mail.id);
  }

  protected toggleStar(id: string): void {
    this.#mailbox.toggleStar(id);
  }

  /** Out of the inbox — the trash, the archive, snoozed — with a moment to
      take it back. The open message moved out closes with it. */
  protected move(id: string, place: MailPlace): void {
    this.#mailbox.move(id, place);
    if (this.open() === id) void this.#router.navigate(['.'], { relativeTo: this.#route });
    this.#snackBar
      .open(this.#i18n.t(MOVED[place]), this.#i18n.t('inbox.undo'), { duration: 4000 })
      .onAction()
      .subscribe(() => this.#mailbox.restore(id));
  }

  constructor() {
    // Rows ticked, as many as wanted: Space, aria-selected.
    inject(Grid).multi.set(true);
  }

  /** A row pointed at or focused: Gmail's head start — its body fetched
      before the click, so the message opens at once. */
  protected prefetch(id: string): void {
    this.#mailbox.prefetch(id);
  }
}
