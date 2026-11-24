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
  /** The message the row shows and opens: its conversation's latest. */
  readonly mail: InboxHeader;
  /** Every message of its conversation, by id — the row stands for them
      all; the one alone where it is in none. */
  readonly ids: readonly string[];
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
 * catalogue's (Gmail's Priority Inbox sections) — a row a conversation
 * (`ReceivedMail.conversations`: its latest message, and how many there
 * are beside the sender), Proton's rows on a `grid` — Gmail's
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
    const row = (conversation: readonly InboxHeader[]): InboxRow => {
      const mail = conversation.at(-1)!;
      const ids = conversation.map(({ id }) => id);
      const date = sent(mail.date);
      return {
        mail,
        ids,
        when:
          date instanceof Date ? (date.toDateString() === today ? time : day).format(date) : date,
        // Unread or starred while any of it is; open whichever of them the path names.
        unread: ids.some((id) => unread.has(id)),
        starred: ids.some((id) => starred.has(id)),
        picked: picked.has(mail.id),
        open: open !== null && ids.includes(open),
      };
    };
    return [
      {
        id: 'imported',
        label: this.#i18n.t('inbox.import.title'),
        rows: this.#mailbox.importedConversations().map(row),
      },
      {
        id: 'mail',
        label: this.#i18n.t('inbox.import.rest'),
        rows: this.#mailbox.conversations().map(row),
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

  /** Read ⇄ unread — the whole conversation. */
  protected toggleRead(row: InboxRow): void {
    for (const id of row.ids) {
      if (row.unread) this.#mailbox.read(id);
      else this.#mailbox.markUnread(id);
    }
  }

  /** Starred ⇄ not: starring marks the latest message; unstarring clears
      every starred message in the conversation. */
  protected toggleStar(row: InboxRow): void {
    if (!row.starred) {
      this.#mailbox.toggleStar(row.mail.id);
      return;
    }
    const starred = this.#mailbox.starred();
    for (const id of row.ids) {
      if (starred.has(id)) this.#mailbox.toggleStar(id);
    }
  }

  /** Out of the inbox — the trash, the archive, snoozed — the whole
      conversation, with a moment to take it back. The open message moved
      out closes with it. */
  protected move(row: InboxRow, place: MailPlace): void {
    for (const id of row.ids) this.#mailbox.move(id, place);
    if (row.open) void this.#router.navigate(['.'], { relativeTo: this.#route });
    this.#snackBar
      .open(this.#i18n.t(MOVED[place]), this.#i18n.t('inbox.undo'), { duration: 4000 })
      .onAction()
      .subscribe(() => row.ids.forEach((id) => this.#mailbox.restore(id)));
  }

  constructor() {
    // Rows ticked, as many as wanted: Space, aria-selected.
    inject(Grid).multi.set(true);
  }

  /** A row pointed at or focused: Gmail's head start — its bodies fetched
      before the click, every message of its conversation (the reader waits
      on all of them), so it opens at once. */
  protected prefetch(ids: readonly string[]): void {
    for (const id of ids) this.#mailbox.prefetch(id);
  }
}
