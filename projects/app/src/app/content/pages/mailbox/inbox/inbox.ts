import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';

import { filter } from 'rxjs';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import { Viewport } from '../../../../core/layout/viewport';
import { ReceivedMail } from '../../../../core/email/mailbox/received-mail';
import { I18n } from '../../../../core/translations/i18n';
import {
  INBOX_LIST_MAX,
  INBOX_LIST_MIN,
  INBOX_READER_MIN,
  Preferences,
} from '../../../../core/storages/preferences';
import { SplitHandle } from '../../../partials/common/split-handle/split-handle';
import { InboxList } from '../../../partials/atomic/inbox/inbox-list/inbox-list';
import { InboxPaper } from '../../../partials/atomic/inbox/inbox-paper';
import { PageHeader } from '../../../partials/common/page-header/page-header';
import { DropHint } from '../../../partials/common/drop-hint/drop-hint';
import { MessageImport } from '../../../partials/common/message-import/message-import';
import { PaperIslandDirective } from '../../../partials/shared/email/paper-island';

/**
 * A pretend mail client: the example catalogue's received mail (`ReceivedMail`)
 * — the list (`InboxList`), and the open message in a routed pane (`/inbox/:id`, `InboxReader`), where its
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
 *
 * The page takes a message in: an `.eml` dropped on it, or a whole message
 * pasted (`MessageImport`) — into the list's Imported section, and open.
 */
@Component({
  selector: 'app-inbox',
  imports: [
    TranslatePipe,
    InboxList,
    MatIcon,
    MatIconButton,
    MatTooltip,
    RouterOutlet,
    SplitHandle,
    PageHeader,
    PaperIslandDirective,
    DropHint,
  ],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
  // The paper the mail is read on: this page's, shared with the reader it
  // routes to (which turns it).
  providers: [InboxPaper],
  // The whole page takes a message in.
  hostDirectives: [{ directive: MessageImport, outputs: ['messageImport'] }],
  host: {
    '[style.--inbox-list-width.px]': 'listWidth()',
    '[attr.data-reading]': 'reading() || null',
    '(messageImport)': 'bringIn($event)',
  },
})
export class Inbox {
  readonly #route = inject(ActivatedRoute);
  readonly #mailbox = inject(ReceivedMail);
  readonly #router = inject(Router);
  readonly #viewport = inject(Viewport);
  readonly #i18n = inject(I18n);
  readonly #snackBar = inject(MatSnackBar);

  /** A file hangs over the page: the drop hint says what letting go does. */
  protected readonly dragging = inject(MessageImport).dragging;

  /** A message brought in: read, put on top of the Imported section, and
      opened. */
  protected async bringIn(file: File): Promise<void> {
    try {
      const id = await this.#mailbox.import(file);
      void this.#router.navigate([id], { relativeTo: this.#route });
    } catch {
      this.#snackBar.open(this.#i18n.t('inbox.import.failed'), undefined, { duration: 4000 });
    }
  }

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
  protected readonly open = signal<string | null>(null);

  /** Whether a message is open in the pane: on a phone, the pane then
      takes the list's place. */
  protected readonly reading = computed(() => this.open() !== null);

  /** The mail's header leads with the way back to the list: on a phone,
      where the open message is a page of its own and the list a jump away.
      On a desk the list stands beside it. */
  protected readonly backButton = computed(() => this.#viewport.compact() && this.reading());

  /** Back to the list: the open message closed, the inbox's own path. */
  protected back(): void {
    void this.#router.navigate(['.'], { relativeTo: this.#route });
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
    this.open.set(id);
    if (id !== null) this.#mailbox.read(id);
  }
}
