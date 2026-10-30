import { Service, computed, inject, resource, signal } from '@angular/core';

import { type InboundMessage, toInboundMessage } from '@h-k-dev/angular-email-editor';

import type { Attachment } from 'postal-mime';

import type { Invite } from '../../calendar/invite';
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
  /** The invitation it carries, where it is one (its `text/calendar`
      part) — what the card above it shows. */
  readonly invite?: Invite;
}

/** The listing as `inbox.json` holds it (`scripts/inbox-listing.mjs`). */
interface InboxListing {
  mails: (Omit<InboxHeader, 'to' | 'date'> & { to?: string; date?: string })[];
}

/** Where a message moved out of the inbox went. */
export type MailPlace = 'trash' | 'archive' | 'snoozed';

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
 * aside's count one state. What a row's actions do — read or not, starred,
 * moved out to the trash, the archive or snoozed — lasts this visit only.
 *
 * On top of the catalogue's, the imported: whole messages brought in by
 * hand (`import`), parsed by postal-mime — lazy, on the first one — and
 * kept in memory, saved nowhere: a reload empties them.
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

  /** Messages moved out of the inbox, by id, and where to. For this visit
      only: a reload brings them back. */
  readonly #moved = signal<ReadonlyMap<string, MailPlace>>(new Map());

  /** What the inbox lists: the headers, less those moved out of it. */
  readonly inbox = computed<readonly InboxHeader[]>(() =>
    this.mails().filter((mail) => !this.#moved().has(mail.id)),
  );

  /** The messages brought in by hand, the latest first — this visit's
      alone. */
  readonly #imported = signal<readonly InboxMail[]>([]);

  /** The inbox's imported section: those brought in, less those moved out. */
  readonly imported = computed<readonly InboxHeader[]>(() =>
    this.#imported().filter((mail) => !this.#moved().has(mail.id)),
  );

  /** How many have been brought in: each one's id. */
  #imports = 0;

  /** The messages opened (or marked read) so far. */
  readonly #read = signal<ReadonlySet<string>>(new Set());

  /** The inbox's messages not yet read, by id — imported ones too. */
  readonly unread = computed(
    () =>
      new Set(
        [...this.inbox(), ...this.imported()]
          .filter((mail) => !this.#read().has(mail.id))
          .map((mail) => mail.id),
      ),
  );

  /** A whole message brought in — an `.eml`, or the raw text of one — read
      by postal-mime and put on top of the imported section, unread. Its inline
      images (`cid:`) are drawn from its own parts. Resolves to its id;
      rejects where nothing can be read from it. */
  async import(raw: Blob | string): Promise<string> {
    const { default: PostalMime } = await import('postal-mime');
    const parsed = await PostalMime.parse(raw);
    const message = toInboundMessage(parsed);
    if (!message.html && !message.text && !message.subject && !message.from) {
      throw new Error('Nothing in it reads as a message.');
    }
    let html = messageHtml(message);
    for (const part of parsed.attachments) {
      const cid = part.contentId?.replace(/^<|>$/g, '');
      if (!cid || typeof part.content === 'string') continue;
      const url = URL.createObjectURL(
        new Blob([part.content as BlobPart], { type: part.mimeType || 'application/octet-stream' }),
      );
      html = html.split(`cid:${cid}`).join(url);
    }
    const invite = await this.#invite(parsed.attachments);
    const id = `imported-${++this.#imports}`;
    const mail: InboxMail = {
      id,
      file: '',
      kind: 'html',
      name: parsed.from?.name || parsed.from?.address || message.from || '',
      from: message.from ?? '',
      to: message.to ?? '',
      cc: message.cc,
      replyTo: message.replyTo,
      date: message.date,
      subject: message.subject ?? '',
      text: message.text,
      html,
      invite,
    };
    this.#imported.update((mails) => [mail, ...mails]);
    return id;
  }

  /** The invitation among a message's parts: the calendar part sent with a
      method (the one inside the message) before an `invite.ics` beside it.
      Its reader, and ical.js with it, loaded only for a message that has
      one. */
  async #invite(parts: readonly Attachment[]): Promise<Invite | undefined> {
    const calendars = parts.filter((part) =>
      ['text/calendar', 'application/ics'].includes(part.mimeType),
    );
    const part = calendars.find((one) => one.method) ?? calendars[0];
    if (!part) return undefined;
    const ics =
      typeof part.content === 'string' ? part.content : new TextDecoder().decode(part.content);
    const { readInvite } = await import('../../calendar/invite');
    return readInvite(ics, part.method) ?? undefined;
  }

  /** Starred messages, by id. */
  readonly #starred = signal<ReadonlySet<string>>(new Set());
  readonly starred = this.#starred.asReadonly();

  /** Bodies asked for, by id: each fetched once. */
  readonly #opened = new Map<string, Promise<InboxMail | null>>();

  /** A message has been opened (or marked read): it is read from then on. */
  read(id: string): void {
    if (this.#read().has(id)) return;
    this.#read.update((read) => new Set(read).add(id));
  }

  /** A message marked unread again, until it is next opened. */
  markUnread(id: string): void {
    if (!this.#read().has(id)) return;
    this.#read.update((read) => {
      const next = new Set(read);
      next.delete(id);
      return next;
    });
  }

  /** Starred ⇄ not. */
  toggleStar(id: string): void {
    this.#starred.update((starred) => {
      const next = new Set(starred);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** A message moved out of the inbox: to the trash, the archive, or
      snoozed away. */
  move(id: string, place: MailPlace): void {
    this.#moved.update((moved) => new Map(moved).set(id, place));
  }

  /** A moved message back in the inbox — the undo. */
  restore(id: string): void {
    if (!this.#moved().has(id)) return;
    this.#moved.update((moved) => {
      const next = new Map(moved);
      next.delete(id);
      return next;
    });
  }

  /** The message with this id, its body fetched — null where the listing
      names none. Once per message; one that failed is fetched again the
      next time it is asked for. */
  open(id: string): Promise<InboxMail | null> {
    const imported = this.#imported().find((mail) => mail.id === id);
    if (imported) return Promise.resolve(imported);
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
