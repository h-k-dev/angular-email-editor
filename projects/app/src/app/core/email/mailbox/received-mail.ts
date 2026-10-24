import { Service, computed, inject, resource, signal } from '@angular/core';

import type { InboundMessage } from '@h-k-dev/angular-email-editor';

import { messageHtml } from '../../dawn/dawn.render';
import { BLANK } from '../envelope';
import { ExampleEntry, ExampleSet, Examples, inbound } from '../examples';

/** A message in the demo inbox: what the library's reply seeds read
    (`InboundMessage`), plus what a list row shows. */
export interface InboxMail extends InboundMessage {
  /** A path segment — `/inbox/:id`. */
  readonly id: string;
  /** The sender's name for the list, without the address. */
  readonly name: string;
  readonly subject: string;
  /** The body to read, as HTML (a fragment or a whole document). */
  readonly html: string;
}

/** The catalogue's sets the inbox holds, in its order: the inbound
    messages first, then the newsletters — the very MJML documents the
    Render page and the render specs read. */
const INBOX_SETS = ['reply', 'mjml'];

/** Whoever the examples were sent to: the account's own address. */
const SELF = BLANK.from.join(', ');

/** "Jane Doe <jane@x>" → "Jane Doe"; a bare address stays as it is. */
function displayName(from: string): string {
  return from.replace(/\s*<[^>]*>\s*$/, '').trim() || from;
}

/** A catalogue name without its provenance: "Worldly (compiled MJML)" →
    "Worldly". */
function shortName(entry: ExampleEntry): string {
  return entry.name.replace(/\s*\([^)]*\)\s*$/, '');
}

/** The file's base name: `mjml/worldly.html` → `worldly`. */
function slug(entry: ExampleEntry): string {
  return entry.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

/** A reply example — an inbound message as JSON — as it arrived. Its
    subject is what the catalogue calls it; it was sent to us. */
function fromReply(set: ExampleSet, entry: ExampleEntry, text: string): InboxMail {
  const message = inbound(text);
  const from = message.from ?? '';
  return {
    ...message,
    id: `${set.key}-${slug(entry)}`,
    name: displayName(from) || entry.name,
    from,
    to: message.to ?? SELF,
    subject: message.subject ?? entry.name,
    html: messageHtml(message),
  };
}

/** An MJML example — a whole newsletter document — as it arrived: from the
    sender its name says, its subject the document's title where it has
    one. It carries no date, so it shows none. */
function fromDocument(set: ExampleSet, entry: ExampleEntry, html: string): InboxMail {
  const name = shortName(entry);
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return {
    id: `${set.key}-${slug(entry)}`,
    name,
    from: `${name} <${slug(entry)}@example.com>`,
    to: SELF,
    subject: title || name,
    html,
  };
}

/**
 * The demo inbox: the example catalogue's received mail — its reply
 * examples, as the messages they are, and its MJML newsletters — never a
 * made-up set beside them. Loaded with the examples (none where nothing
 * serves them: a unit test, an offline start), and read here: every
 * message unread until it is opened, the list, the reader and the aside's
 * count one state.
 */
@Service()
export class ReceivedMail {
  readonly #examples = inject(Examples);

  readonly #source = resource({ loader: () => this.#load() });

  /** The inbox, in the catalogue's order. Empty until it has loaded. */
  readonly mails = computed<readonly InboxMail[]>(() =>
    this.#source.hasValue() ? this.#source.value() : [],
  );

  /** Whether the inbox has come — or will not: only then is a message
      that is not in it missing, rather than on its way. */
  readonly settled = computed(() => !this.#source.isLoading());

  /** The messages opened so far. */
  readonly #read = signal<ReadonlySet<string>>(new Set());

  /** Messages not yet opened, by id. */
  readonly unread = computed(
    () => new Set(this.mails().filter((mail) => !this.#read().has(mail.id)).map((mail) => mail.id)),
  );

  /** A message has been opened: it is read from then on. */
  read(id: string): void {
    if (this.#read().has(id)) return;
    this.#read.update((read) => new Set(read).add(id));
  }

  async #load(): Promise<readonly InboxMail[]> {
    const sets = await this.#examples.sets();
    const mails = await Promise.all(
      sets
        .filter((set) => INBOX_SETS.includes(set.key))
        .sort((a, b) => INBOX_SETS.indexOf(a.key) - INBOX_SETS.indexOf(b.key))
        .flatMap((set) =>
          set.examples.map(async (entry) => {
            const text = await this.#examples.raw(entry);
            return set.kind === 'reply'
              ? fromReply(set, entry, text)
              : fromDocument(set, entry, text);
          }),
        ),
    );
    return mails;
  }
}
