import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Angular Material
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

// Angular Email Editor
import { ReplyKind, forwardQuote, replyEnvelope, replyQuote } from '@h-k-dev/angular-email-editor';
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';
import { TranslatePipe } from '@ngx-translate/core';

import { ComposeWindows } from '../../../../../core/email/compose-windows';
import { BLANK } from '../../../../../core/email/envelope';
import { INBOX } from '../../../../../core/email/mailbox/mails';
import { readingDocument } from '../../../../../core/render/render';
import { Paper } from '../../../../../core/theme/paper';
import { I18n } from '../../../../../core/translations/i18n';
import { PaperIslandDirective } from '../../../shared/email/paper-island';

/**
 * One message of the inbox, read — the inbox's routed pane (`/inbox/:id`):
 * beside the list on a desk, the whole screen on a phone. The message is
 * drawn as a client draws it (`readingDocument`, core/render) on the
 * editor's own paper, light or dark as the editor is (`Paper`): the header
 * and the body one sheet, a paper island, as a composer is.
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
  imports: [TranslatePipe, MatButtonModule, MatIcon, PaperIslandDirective],
  templateUrl: './inbox-reader.html',
  styleUrl: './inbox-reader.scss',
})
export class InboxReader {
  readonly #windows = inject(ComposeWindows);
  readonly #i18n = inject(I18n);
  readonly #sanitizer = inject(DomSanitizer);
  readonly #palette = injectPalette();

  /** The message's id — the route's `:id`. */
  readonly id = input.required<string>();

  /** The message, or nothing where the id names none. */
  protected readonly mail = computed(() => INBOX.find((mail) => mail.id === this.id()) ?? null);

  /** The paper it is read on: the editor's. */
  protected readonly scheme = inject(Paper).scheme;

  /** Its date in full, in the app's language. */
  protected readonly date = computed(() => {
    const mail = this.mail();
    return mail
      ? new Intl.DateTimeFormat(this.#i18n.lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(
          mail.date,
        )
      : '';
  });

  /** The body as a document for the frame — a frame with no scripts, so
      passing the sanitizer by is safe here, as the compose preview's is. */
  protected readonly document = computed<SafeHtml>(() =>
    this.#sanitizer.bypassSecurityTrustHtml(
      readingDocument(this.mail()?.html ?? '', { scheme: this.scheme(), darkMode: this.#palette }),
    ),
  );

  /** The frame's height: its document's, so the reader scrolls as one
      sheet and the frame never shows a scrollbar of its own. */
  protected readonly height = signal(0);
  #observer: ResizeObserver | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#observer?.disconnect());
  }

  /** The frame has drawn its document (again, after a scheme change):
      fit it, and keep fitting it as its width reflows the email. */
  protected fit(frame: HTMLIFrameElement): void {
    this.#observer?.disconnect();
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    const measure = () => this.height.set(Math.ceil(root.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    this.#observer = new ResizeObserver(measure);
    this.#observer.observe(root);
  }

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
