import {
  Component,
  ElementRef,
  Injector,
  ResourceSnapshot,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  resource,
} from '@angular/core';

// Angular Email Editor
import {
  ReplyKind,
  forwardQuote,
  replyEnvelope,
  replyQuote,
  splitQuoted,
} from '@h-k-dev/angular-email-editor';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { BLANK } from '../../../../../core/email/envelope';
import { InboxMail, ReceivedMail } from '../../../../../core/email/mailbox/received-mail';
import { I18n } from '../../../../../core/translations/i18n';
import { MailView } from '../../../shared/email/mail-view/mail-view';
import { InboxPaper } from '../inbox-paper';
import { InviteCard } from '../invite-card/invite-card';

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
 * A message that is part of a conversation is read in it (Gmail's): the
 * conversation's subject once, its messages oldest first
 * (`ReceivedMail.openConversation`, the library's `threadMessages`) — the
 * latest open, and the one the path names; the earlier ones a line each
 * (who, how it starts, when) until pressed. What a message quotes of the
 * mail it answers is folded behind a `⋯` (Dawn's `foldQuoted`): there it
 * stands right above.
 *
 * The production shape: the list (the master) holds only each message's
 * light metadata; this reader is given the id alone and fetches the message
 * by it (`ReceivedMail.open`, after the mock's latency — at once where the
 * row's pointing fetched it already). The last message stays on screen
 * until the next one has come.
 */
@Component({
  selector: 'app-inbox-reader',
  imports: [TranslatePipe, MailView, InviteCard],
  templateUrl: './inbox-reader.html',
  styleUrl: './inbox-reader.scss',
})
export class InboxReader {
  readonly #windows = inject(ComposeWindows);
  readonly #i18n = inject(I18n);
  readonly #mailbox = inject(ReceivedMail);
  readonly #paper = inject(InboxPaper);
  readonly #host: HTMLElement = inject(ElementRef).nativeElement;
  readonly #injector = inject(Injector);

  /** The message's id — the route's `:id`. */
  readonly id = input.required<string>();

  /** The message's conversation, fetched by the path's id — the message
      alone where it is in none. Read from then on, all of it. */
  readonly #loaded = resource({
    params: () => this.id(),
    loader: async ({ params, abortSignal }) => {
      const conversation = await this.#mailbox.openConversation(params);
      if (!abortSignal.aborted) conversation?.forEach((mail) => this.#mailbox.read(mail.id));
      return conversation;
    },
  });

  /** The conversation on screen — held while a load is open (a render,
      even where the row's pointing fetched it already): moving between
      messages swaps the sheet in place instead of dropping it and drawing
      it anew. On the status, not `value ?? previous`: an id that names no
      message, or a failed load, clears it (→ `missing`). */
  protected readonly conversation = linkedSignal<
    ResourceSnapshot<readonly InboxMail[] | null | undefined>,
    readonly InboxMail[] | null
  >({
    source: this.#loaded.snapshot,
    computation: (snapshot, previous) => {
      if (snapshot.status === 'loading' || snapshot.status === 'reloading')
        return previous?.value ?? null;
      return snapshot.status === 'error' ? null : (snapshot.value ?? null);
    },
  });

  /** The messages open, by id: the latest and the one the path names, to
      start with — then every one pressed. A new conversation starts anew. */
  protected readonly expanded = linkedSignal<readonly InboxMail[] | null, ReadonlySet<string>>({
    source: this.conversation,
    computation: (conversation) =>
      new Set([conversation?.at(-1)?.id, this.id()].filter((id) => id !== undefined)),
  });

  /** An earlier message's line, pressed: the message, open — and the
      keyboard on it, where the line it replaced was (else it would fall to
      the page's start). */
  protected expand(id: string): void {
    this.expanded.update((expanded) => new Set(expanded).add(id));
    afterNextRender(
      () =>
        Array.from(this.#host.querySelectorAll<HTMLElement>('.inbox-reader__mail'))
          .find((sheet) => sheet.dataset['mail'] === id)
          ?.focus(),
      { injector: this.#injector },
    );
  }

  /** The id names no message, or it cannot be fetched. */
  protected readonly missing = computed(() => {
    const loaded = this.#loaded.snapshot();
    return loaded.status === 'error' || (loaded.status === 'resolved' && loaded.value === null);
  });

  /** The paper it is read on (`InboxPaper`). */
  protected readonly paper = this.#paper.scheme;

  /** The sender's address, beside the name: the part of `from` in angle
      brackets — none where `from` is a bare address (the name is it). */
  protected address(mail: InboxMail): string | null {
    return /<([^>]+)>/.exec(mail.from)?.[1] ?? null;
  }

  /** Its date in full, in the app's language — or as the message wrote it
      out itself, or none. */
  protected date(mail: InboxMail): string {
    const { date } = mail;
    if (!(date instanceof Date)) return date ?? '';
    return new Intl.DateTimeFormat(this.#i18n.lang(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  /** How each message starts, by id — a folded one's line: its own text,
      without the history it quotes (Dawn's `splitQuoted`), a line's worth. */
  protected readonly starts = computed(
    () => new Map((this.conversation() ?? []).map((mail) => [mail.id, startOf(mail.html)])),
  );

  /** The paper button: the mail read on the other paper. */
  protected flipPaper(): void {
    this.#paper.flip();
  }

  /** An answer, seeded from the message whose buttons were pressed. */
  protected answer(kind: ReplyKind, mail: InboxMail): void {
    const { to, cc, subject } = replyEnvelope(mail, kind, { self: BLANK.from });
    const quoted = kind === 'forward' ? forwardQuote(mail) : replyQuote(mail);
    this.#windows.compose({
      content: { message: { ...BLANK, to, cc, subject, quoted }, images: [] },
      focus: kind === 'forward' ? 'to' : 'body',
    });
  }
}

/** How much of a folded message's start is read for its line. */
const START_LENGTH = 160;

function startOf(html: string): string {
  const own = new DOMParser().parseFromString(splitQuoted(html).body, 'text/html');
  own.querySelectorAll('style, title, script, noscript').forEach((element) => element.remove());
  // A line's end is a word's end: `textContent` alone runs two lines together.
  own.body.querySelectorAll('br, div, p, li, td').forEach((element) => element.before(' '));
  return (own.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, START_LENGTH);
}
