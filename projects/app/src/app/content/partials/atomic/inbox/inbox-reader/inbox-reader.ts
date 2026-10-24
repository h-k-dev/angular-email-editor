import { Component, computed, inject, input } from '@angular/core';

// Angular Material
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Angular Email Editor
import { ReplyKind, forwardQuote, replyEnvelope, replyQuote } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { BLANK } from '../../../../../core/email/envelope';
import { ReceivedMail } from '../../../../../core/email/mailbox/received-mail';
import { Paper } from '../../../../../core/theme/paper';
import { I18n } from '../../../../../core/translations/i18n';
import { EmailViewer } from '../../../common/email-viewer/email-viewer';
import { PaperIslandDirective } from '../../../shared/email/paper-island';

/**
 * One message of the inbox, read — the inbox's routed pane (`/inbox/:id`):
 * beside the list on a desk, the whole screen on a phone. The body is an
 * `email-viewer` — drawn as a client draws it, on the editor's own paper,
 * light or dark as the editor is (`Paper`) — and the header sits on the
 * same paper: one sheet, a paper island, as a composer is.
 *
 * Under it the three answers every client has — Reply, Reply all, Forward —
 * each a compose window seeded the way a real client seeds it, with the
 * library's helpers: `replyEnvelope` for who the answer goes to and what it
 * is called, `replyQuote` / `forwardQuote` for the quoted history the
 * editor keeps under the text. A reply's rows are filled, so its caret
 * starts in the editor; a forward has nobody to go to yet, so its caret
 * starts in To.
 */
@Component({
  selector: 'app-inbox-reader',
  imports: [TranslatePipe, MatButtonModule, MatIcon, EmailViewer, PaperIslandDirective],
  templateUrl: './inbox-reader.html',
  styleUrl: './inbox-reader.scss',
})
export class InboxReader {
  readonly #windows = inject(ComposeWindows);
  readonly #i18n = inject(I18n);
  readonly #mailbox = inject(ReceivedMail);

  /** The message's id — the route's `:id`. */
  readonly id = input.required<string>();

  /** The message, or nothing where the id names none (or the inbox is
      still on its way). */
  protected readonly mail = computed(
    () => this.#mailbox.mails().find((mail) => mail.id === this.id()) ?? null,
  );

  /** Whether the inbox has come: only then is a message not in it missing. */
  protected readonly settled = this.#mailbox.settled;

  /** The paper it is read on: the editor's. */
  protected readonly scheme = inject(Paper).scheme;

  /** Its date in full, in the app's language — or as the message wrote it
      out itself, or none. */
  protected readonly date = computed(() => {
    const date = this.mail()?.date;
    if (!(date instanceof Date)) return date ?? '';
    return new Intl.DateTimeFormat(this.#i18n.lang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  });

  protected answer(kind: ReplyKind): void {
    const mail = this.mail();
    if (!mail) return;
    const { to, cc, subject } = replyEnvelope(mail, kind, { self: BLANK.from });
    const quoted = kind === 'forward' ? forwardQuote(mail) : replyQuote(mail);
    void this.#windows.open({
      content: { message: { ...BLANK, to, cc, subject, quoted }, images: [] },
      focus: kind === 'forward' ? 'to' : 'body',
    });
  }
}
