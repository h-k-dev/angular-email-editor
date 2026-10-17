import { Component, computed, inject, signal } from '@angular/core';

// Angular Material
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Angular Email Editor
import { ReplyKind, forwardQuote, replyEnvelope, replyQuote } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { BLANK } from '../compose/message-form/envelope';
import { ComposeWindows } from '../../services/compose-windows';
import { I18n } from '../../services/i18n';
import { INBOX, InboxMail } from './mails';

/** One row of the list, worked out once per language: the message, and
    the date as the list shows it. */
interface InboxRow {
  readonly mail: InboxMail;
  readonly when: string;
}

/**
 * A pretend mail client: an inbox of made-up messages, one open beside the
 * list, and the three answers every client has — Reply, Reply all,
 * Forward. Each opens a compose window seeded the way a real client seeds
 * it, with the library's own helpers: `replyEnvelope` for who the answer
 * goes to and what it is called, `replyQuote` / `forwardQuote` for the
 * quoted history the editor keeps under the text.
 *
 * It is here to show where the caret starts. A reply's To and subject are
 * filled, so its window opens with the caret in the editor, above the
 * quote (`focus: 'body'` — the sheet marks the editor `cdkFocusInitial`
 * and the CDK's initial focus puts the caret there); a forward has nobody
 * to go to yet, so its caret starts in To, as a new message's does.
 */
@Component({
  selector: 'app-inbox',
  imports: [TranslatePipe, MatButtonModule, MatIcon],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
})
export class Inbox {
  readonly #windows = inject(ComposeWindows);
  readonly #i18n = inject(I18n);

  /** The messages read so far — opening one reads it. */
  readonly #read = signal<ReadonlySet<string>>(new Set());

  /** The open message's id. */
  protected readonly openId = signal(INBOX[0].id);

  /** The open message. */
  protected readonly open = computed(
    () => INBOX.find((mail) => mail.id === this.openId()) ?? INBOX[0],
  );

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

  /** The open message's date in full, in the app's language. */
  protected readonly openDate = computed(() =>
    new Intl.DateTimeFormat(this.#i18n.lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      this.open().date,
    ),
  );

  constructor() {
    this.select(INBOX[0].id);
  }

  protected select(id: string): void {
    this.openId.set(id);
    this.#read.update((read) => new Set(read).add(id));
  }

  /**
   * Answers the open message in a compose window. A reply or a reply-all
   * starts with its rows filled — To (and Cc) from the message, the subject
   * "Re:" — and the quoted history under an empty first line, so the caret
   * starts in the editor; a forward has nobody to go to yet, so its caret
   * starts in To.
   */
  protected answer(kind: ReplyKind): void {
    const mail = this.open();
    const { to, cc, subject } = replyEnvelope(mail, kind, { self: BLANK.from });
    const quoted = kind === 'forward' ? forwardQuote(mail) : replyQuote(mail);
    void this.#windows.open({
      content: { message: { ...BLANK, to, cc, subject, quoted }, images: [] },
      focus: kind === 'forward' ? 'to' : 'body',
    });
  }
}
