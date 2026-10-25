import { Service, computed, inject, resource, signal } from '@angular/core';

import type { InboundMessage } from '@h-k-dev/angular-email-editor';

import { messageHtml } from '../../dawn/dawn.render';
import { BLANK } from '../envelope';
import { ExampleAssets, inbound, sentDate } from '../examples';

/** A message as the inbox lists it — the listing's line (`inbox.json`):
    what a row shows and the reader heads the message with, without its
    body. */
export interface InboxHeader extends Omit<InboundMessage, 'html' | 'text'> {
  /** A path segment — `/inbox/:id`. */
  readonly id: string;
  /** Where its body is, under the examples. */
  readonly file: string;
  /** What the file holds: `reply` — an inbound message as JSON; `html` —
      the document itself. */
  readonly kind: 'reply' | 'html';
  /** The sender's name for the list, without the address. */
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
}

/** A message, opened: its header, and what the library's reply seeds read
    (`InboundMessage`). */
export interface InboxMail extends InboxHeader {
  /** The body to read, as HTML (a fragment or a whole document). */
  readonly html: string;
  readonly text?: string;
}

/** The listing as `inbox.json` holds it (`scripts/inbox-listing.mjs`). */
interface InboxListing {
  mails: (Omit<InboxHeader, 'to' | 'date'> & { to?: string; date?: string })[];
}

/** Whoever the examples were sent to: the account's own address. */
const SELF = BLANK.from.join(', ');

/**
 * The demo inbox: the example catalogue's received mail — its reply
 * examples, as the messages they are, and its MJML newsletters — never a
 * made-up set beside them.
 *
 * Read the way Gmail reads a mailbox: the listing first (`inbox.json`, a
 * header per message, written out of the files by
 * `scripts/inbox-listing.mjs`), then a message's body only when it is
 * opened — its path, `/inbox/:id` — or about to be (a row pointed at),
 * each once. None where nothing serves them: a unit test, an offline start.
 * Every message unread until it is opened, the list, the reader and the
 * aside's count one state.
 */
@Service()
export class ReceivedMail {
  readonly #assets = inject(ExampleAssets);

  readonly #listing = this.#assets.file('inbox.json').then(
    (text) =>
      (JSON.parse(text) as InboxListing).mails.map<InboxHeader>((line) => ({
        ...line,
        to: line.to ?? SELF,
        date: sentDate(line.date),
      })),
    (): InboxHeader[] => [],
  );

  readonly #source = resource({ loader: () => this.#listing });

  /** The inbox's headers, in the catalogue's order. Empty until the
      listing has come. */
  readonly mails = computed<readonly InboxHeader[]>(() =>
    this.#source.hasValue() ? this.#source.value() : [],
  );

  /** Whether the listing has come — or will not: only then is a message
      that is not in it missing, rather than on its way. */
  readonly settled = computed(() => !this.#source.isLoading());

  /** The messages opened so far. */
  readonly #read = signal<ReadonlySet<string>>(new Set());

  /** Messages not yet opened, by id. */
  readonly unread = computed(
    () => new Set(this.mails().filter((mail) => !this.#read().has(mail.id)).map((mail) => mail.id)),
  );

  /** Bodies asked for, by id: each fetched once. */
  readonly #opened = new Map<string, Promise<InboxMail | null>>();

  /** A message has been opened: it is read from then on. */
  read(id: string): void {
    if (this.#read().has(id)) return;
    this.#read.update((read) => new Set(read).add(id));
  }

  /** The message with this id, its body fetched — null where the listing
      names none. Once per message; one that failed is fetched again the
      next time it is asked for. */
  open(id: string): Promise<InboxMail | null> {
    let pending = this.#opened.get(id);
    if (!pending) {
      pending = this.#fetch(id);
      pending.catch(() => this.#opened.delete(id));
      this.#opened.set(id, pending);
    }
    return pending;
  }

  /** A message about to be opened (its row pointed at, focused): its body
      on its way already, so opening it is instant. */
  prefetch(id: string): void {
    this.open(id).catch(() => undefined);
  }

  async #fetch(id: string): Promise<InboxMail | null> {
    const header = (await this.#listing).find((mail) => mail.id === id);
    if (!header) return null;
    const text = await this.#assets.file(header.file);
    if (header.kind === 'html') return { ...header, html: text };
    const message = inbound(text);
    return { ...header, text: message.text, html: messageHtml(message) };
  }
}
