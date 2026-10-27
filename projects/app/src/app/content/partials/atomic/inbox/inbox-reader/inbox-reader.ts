import {
  Component,
  ResourceSnapshot,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';

// Angular Email Editor
import { ReplyKind, forwardQuote, replyEnvelope, replyQuote } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { BLANK } from '../../../../../core/email/envelope';
import { InboxMail, ReceivedMail } from '../../../../../core/email/mailbox/received-mail';
import { I18n } from '../../../../../core/translations/i18n';
import { MailView } from '../../../shared/email/mail-view/mail-view';
import { InboxPaper } from '../inbox-paper';

/**
 * One message of the inbox, read — the inbox's routed pane (`/inbox/:id`):
 * beside the list on a desk, the whole screen on a phone. The body is an
 * `email-viewer`, drawn by Dawn on the reading paper (`InboxPaper`, the
 * inbox page's — the editor's, or the other one this reader's button turned
 * to); the header sits on the same paper: one sheet, on the pane's island —
 * the `mail-view`, which lays itself out by the pane's width (a container
 * query), so a phone, a phone-wide pane and the designer's drawn phone
 * show it alike. This reader is what makes it the inbox's: the route's
 * message, its paper, and what its answers open.
 *
 * The header is Gmail's, without its avatar: the subject, who sent it and to
 * whom, and at the line's end the date, the paper button and the answers
 * every client has — Reply, and Reply all and Forward in ⋮ — and, Gmail's
 * again, the three written out under the mail, where the reading ends; each a compose
 * window seeded the way a real client seeds it, with the library's helpers:
 * `replyEnvelope` for who the answer goes to and what it is called,
 * `replyQuote` / `forwardQuote` for the quoted history the editor keeps
 * under the text. A reply's rows are filled, so its caret starts in the
 * editor; a forward has nobody to go to yet, so its caret starts in To.
 *
 * The production shape: the list (the master) holds only each message's
 * light metadata; this reader is given the id alone and fetches the message
 * by it (`ReceivedMail.open`, after the mock's latency — at once where the
 * row's pointing fetched it already). The last message stays on screen
 * until the next one has come.
 */
@Component({
  selector: 'app-inbox-reader',
  imports: [TranslatePipe, MailView],
  templateUrl: './inbox-reader.html',
  styleUrl: './inbox-reader.scss',
})
export class InboxReader {
  readonly #windows = inject(ComposeWindows);
  readonly #i18n = inject(I18n);
  readonly #mailbox = inject(ReceivedMail);
  readonly #paper = inject(InboxPaper);

  /** The message's id — the route's `:id`. */
  readonly id = input.required<string>();

  /** The message, fetched by the path's id. */
  readonly #loaded = resource({
    params: () => this.id(),
    loader: ({ params }) => this.#mailbox.open(params),
  });

  /** The message on screen — held while a load is open (a render, even
      where the row's pointing fetched it already): moving between messages
      swaps the sheet in place instead of dropping it and drawing it anew.
      On the status, not `value ?? previous`: an id that names no message,
      or a failed load, clears it (→ `missing`). */
  protected readonly mail = linkedSignal<
    ResourceSnapshot<InboxMail | null | undefined>,
    InboxMail | null
  >({
    source: this.#loaded.snapshot,
    computation: (snapshot, previous) => {
      if (snapshot.status === 'loading' || snapshot.status === 'reloading')
        return previous?.value ?? null;
      return snapshot.status === 'error' ? null : (snapshot.value ?? null);
    },
  });

  /** The id names no message, or it cannot be fetched. */
  protected readonly missing = computed(() => {
    const loaded = this.#loaded.snapshot();
    return loaded.status === 'error' || (loaded.status === 'resolved' && loaded.value === null);
  });

  /** The paper it is read on (`InboxPaper`). */
  protected readonly paper = this.#paper.scheme;

  /** The sender's address, beside the name: the part of `from` in angle
      brackets — none where `from` is a bare address (the name is it). */
  protected readonly address = computed(
    () => /<([^>]+)>/.exec(this.mail()?.from ?? '')?.[1] ?? null,
  );

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

  /** The paper button: the mail read on the other paper. */
  protected flipPaper(): void {
    this.#paper.flip();
  }

  /** An answer, seeded from the message on screen — the buttons are its. */
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
