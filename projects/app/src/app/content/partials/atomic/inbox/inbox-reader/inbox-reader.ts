import { Component, computed, inject, input, resource } from '@angular/core';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Aria
import { MenuTrigger } from '@angular/aria/menu';

// Angular Email Editor
import { ReplyKind, forwardQuote, replyEnvelope, replyQuote } from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { BLANK } from '../../../../../core/email/envelope';
import { ReceivedMail } from '../../../../../core/email/mailbox/received-mail';
import { Viewport } from '../../../../../core/layout/viewport';
import { I18n } from '../../../../../core/translations/i18n';
import { EmailViewer } from '../../../common/email-viewer/email-viewer';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../../shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { InboxPaper } from '../inbox-paper';

/**
 * One message of the inbox, read — the inbox's routed pane (`/inbox/:id`):
 * beside the list on a desk, the whole screen on a phone. The body is an
 * `email-viewer`, drawn by Dawn on the reading paper (`InboxPaper`, the
 * inbox page's — the editor's, or the other one this reader's button turned
 * to); the header sits on the same paper: one sheet, on the pane's island.
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
 * Gmail's lazy reading: the header is the listing's, there at once; the
 * body is fetched by the path's id (`ReceivedMail.open`) and drawn when it
 * comes — at once too, where the row's pointing fetched it already.
 */
@Component({
  selector: 'app-inbox-reader',
  imports: [TranslatePipe, MatButton, MatIconButton, MatIcon, MenuTrigger, ToolbarMenu, EmailViewer],
  templateUrl: './inbox-reader.html',
  styleUrl: './inbox-reader.scss',
})
export class InboxReader {
  readonly #windows = inject(ComposeWindows);
  readonly #i18n = inject(I18n);
  readonly #mailbox = inject(ReceivedMail);
  readonly #paper = inject(InboxPaper);
  readonly #viewport = inject(Viewport);

  /** The message's id — the route's `:id`. */
  readonly id = input.required<string>();

  /** The message's header, from the listing — or nothing where the id
      names none (or the listing is still on its way). */
  protected readonly header = computed(
    () => this.#mailbox.mails().find((mail) => mail.id === this.id()) ?? null,
  );

  /** The message's body, fetched for the path's id. */
  readonly #body = resource({
    params: () => this.id(),
    loader: ({ params }) => this.#mailbox.open(params),
  });

  /** The message opened: header and body — nothing while the body is on its
      way (the last message's never stands in for it). */
  protected readonly mail = computed(() => {
    const mail = this.#body.hasValue() ? this.#body.value() : null;
    return mail?.id === this.id() ? mail : null;
  });

  /** Whether the message is missing: the listing has come without it, or
      its body cannot be fetched. */
  protected readonly missing = computed(
    () => (this.#mailbox.settled() && !this.header()) || this.#body.status() === 'error',
  );

  /** The paper it is read on (`InboxPaper`). */
  protected readonly paper = this.#paper.scheme;

  /** The header's side inset (the stylesheet's `--_inset`: 32px, 16px on
      a phone), for a simple email's text to line up under it inside its
      frame; a newsletter runs edge to edge. */
  protected readonly inset = computed(() => (this.#viewport.compact() ? 16 : 32));

  /** The sender's address, beside the name: the part of `from` in angle
      brackets — none where `from` is a bare address (the name is it). */
  protected readonly address = computed(
    () => /<([^>]+)>/.exec(this.header()?.from ?? '')?.[1] ?? null,
  );

  /** Its date in full, in the app's language — or as the message wrote it
      out itself, or none. */
  protected readonly date = computed(() => {
    const date = this.header()?.date;
    if (!(date instanceof Date)) return date ?? '';
    return new Intl.DateTimeFormat(this.#i18n.lang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  });

  /** ⋮: the answers beside Reply, in the app's language. */
  protected readonly moreItems = computed<ToolbarMenuItem<ReplyKind>[]>(() => [
    { value: 'reply-all', label: this.#i18n.t('inbox.replyAll'), icon: 'reply_all' },
    { value: 'forward', label: this.#i18n.t('inbox.forward'), icon: 'forward' },
  ]);

  /** The paper button: the mail read on the other paper. */
  protected flipPaper(): void {
    this.#paper.flip();
  }

  /** An answer, seeded from the whole message: asked for before its body
      came, it waits for it. */
  protected async answer(kind: ReplyKind): Promise<void> {
    const mail = this.mail() ?? (await this.#mailbox.open(this.id()).catch(() => null));
    if (!mail) return;
    const { to, cc, subject } = replyEnvelope(mail, kind, { self: BLANK.from });
    const quoted = kind === 'forward' ? forwardQuote(mail) : replyQuote(mail);
    void this.#windows.open({
      content: { message: { ...BLANK, to, cc, subject, quoted }, images: [] },
      focus: kind === 'forward' ? 'to' : 'body',
    });
  }
}
