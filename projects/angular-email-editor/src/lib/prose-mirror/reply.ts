import { Fragment, Node, Schema } from 'prosemirror-model';
import { addressKey, formatMailbox, isMailbox, splitAddresses } from 'angular-email-editor/address';
import { createSchema } from './schema';
import { ParseOptions, parseHTML, serializeToHTML } from './html';
import { withQuoted } from './extensions/quoted-history';
import { emailExtensions } from './extensions/kits';
import { ruleScope } from './parse-mode';

/**
 * The inbound message a reply or forward is built from. Everything here is
 * caller-supplied **data**: the documents render what becomes content — the
 * reply attribution line, the forwarded-message header block — and
 * {@link replyEnvelope} reads the addressing to propose who the answer goes
 * to. Sending stays the host's.
 *
 * Address fields are header form — mailboxes separated by commas, a name
 * holding a comma quoted: `Jane <jane@x>, "Miller, Bob" <bob@x>`.
 */
export interface InboundMessage {
  /** The inbound body as HTML. Preferred over `text` when both exist. */
  html?: string;
  /** The `text/plain` part — the content when no HTML part exists. */
  text?: string;
  /** Sender, rendered exactly as given ("Jane Doe" or "Jane <jane@x>"). */
  from?: string;
  /** Sent date: a `Date` (formatted via `locale`) or a preformatted string. */
  date?: Date | string;
  /** The forward header's Subject line, and what a reply's subject answers. */
  subject?: string;
  /** The forward header's To line, and who a reply-all copies. */
  to?: string;
  /** Who a reply-all copies besides `to`. Never rendered. */
  cc?: string;
  /** Where the sender asked answers to go — a reply goes there instead of
      `from` when it is set. Never rendered. */
  replyTo?: string;
}

export interface ComposeSeedOptions {
  /** BCP 47 locale for formatting a `Date`-typed `date`. Default `en-US`.
      A string `date` is always used verbatim — pass one for full control. */
  locale?: string;
  /** The words the seeds write into the document, in the host's language.
      Each one left out stays English. */
  labels?: ComposeSeedLabels;
}

/**
 * The words a reply or forward writes into the document. Plain text, never
 * markup — the seeds put them into text nodes, so a sender's `<` stays a `<`.
 * A host with translation files maps its keys here once:
 *
 * ```ts
 * labels: {
 *   attribution: ({ from, date }) =>
 *     from ? translate.instant('REPLY.WROTE', { from, date }) : null,
 *   forwarded: translate.instant('FORWARD.HEADER'),
 *   from: translate.instant('FORWARD.FROM'),
 * }
 * ```
 */
export interface ComposeSeedLabels {
  /** The reply's attribution line, from what is known of the message — the
      sender as given, the date already formatted for `locale`; either may be
      missing. A function, not a pattern, because languages order the two
      differently ("Am {date} schrieb {from}:") and each decides what a
      partial line says. Null or empty: no line; the quote stands alone.
      Default: "On {date}, {from} wrote:", "{from} wrote:", "On {date}:". */
  attribution?: (known: { from?: string; date?: string }) => string | null;
  /** The prefix a reply's subject starts with, space included. Default "Re: ". */
  re?: string;
  /** The prefix a forward's subject starts with, space included. Default "Fwd: ". */
  fwd?: string;
  /** The forward's opening line. Default "---------- Forwarded message ---------". */
  forwarded?: string;
  /** The forward header's field names. Default "From", "Date", "Subject", "To". */
  from?: string;
  date?: string;
  subject?: string;
  to?: string;
}

const ENGLISH: Required<ComposeSeedLabels> = {
  attribution: ({ from, date }) => {
    if (date && from) return `On ${date}, ${from} wrote:`;
    if (from) return `${from} wrote:`;
    if (date) return `On ${date}:`;
    return null;
  },
  re: 'Re: ',
  fwd: 'Fwd: ',
  forwarded: '---------- Forwarded message ---------',
  from: 'From',
  date: 'Date',
  subject: 'Subject',
  to: 'To',
};

const labelsOf = (options?: ComposeSeedOptions): Required<ComposeSeedLabels> => ({
  ...ENGLISH,
  ...options?.labels,
});

/**
 * The shape modern MIME parsers hand back — postal-mime's `Email`, and
 * anything structurally like it. Accepted **duck-typed** so this library
 * never depends on any parser: parsing `.eml` is a solved problem with a
 * decade of edge-case scar tissue (postal-mime, mailparser), and we don't
 * compete with it. {@link toInboundMessage} is the whole integration.
 */
export interface ParsedEmailLike {
  html?: string | null;
  text?: string | null;
  subject?: string | null;
  /** ISO string (postal-mime), `Date`, or any human-readable string. */
  date?: string | Date | null;
  from?: ParsedAddressLike | null;
  to?: ParsedAddressLike[] | null;
  cc?: ParsedAddressLike[] | null;
  replyTo?: ParsedAddressLike[] | null;
}

export interface ParsedAddressLike {
  name?: string | null;
  address?: string | null;
}

/**
 * Bridges a parser result into the seeds — the only glue an `.eml` import
 * needs, front- or backend-parsed alike:
 *
 * ```ts
 * const parsed = await PostalMime.parse(file);           // File is a Blob
 * html.set(importedDocument(toInboundMessage(parsed)));  // import it
 * // …or replyDocument(toInboundMessage(parsed)) to answer it.
 * ```
 *
 * Every field is optional and null-tolerant, so a partial parse still seeds
 * a sensible document. A parseable date becomes a `Date` (the seeds format
 * it via Intl with your locale); anything else passes through verbatim.
 */
export function toInboundMessage(parsed: ParsedEmailLike): InboundMessage {
  return {
    html: parsed.html ?? undefined,
    text: parsed.text ?? undefined,
    subject: parsed.subject ?? undefined,
    date: normalizeDate(parsed.date),
    from: formatAddress(parsed.from),
    to: formatAddresses(parsed.to),
    cc: formatAddresses(parsed.cc),
    replyTo: formatAddresses(parsed.replyTo),
  };
}

/** One header-form mailbox — the name quoted when it has to be, so
    `Miller, Bob` stays one mailbox in a list. */
function formatAddress(address: ParsedAddressLike | null | undefined): string | undefined {
  if (!address) return undefined;
  const name = address.name?.trim();
  const email = address.address?.trim();
  if (email) return formatMailbox({ name: name || undefined, address: email });
  return name || undefined;
}

function formatAddresses(addresses: ParsedAddressLike[] | null | undefined): string | undefined {
  return (
    (addresses ?? [])
      .map((address) => formatAddress(address))
      .filter(Boolean)
      .join(', ') || undefined
  );
}

function normalizeDate(date: string | Date | null | undefined): Date | string | undefined {
  if (date == null) return undefined;
  if (date instanceof Date) return date;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed;
}

// Reply/forward are document *constructors*: pure (inbound data → canonical
// HTML), so the host seeds the composer through the one `html` signal it
// already binds — no component API, no second source of truth. The inbound
// body parses through the email schema like any paste (one law: full strip,
// which doubles as sanitization), so foreign markup dies on the way in.
let seedSchema: Schema | undefined;
const getSchema = () => (seedSchema ??= createSchema(emailExtensions));

/**
 * The quoted history of a reply: the attribution line and the inbound
 * message wrapped in a blockquote — what the editor keeps beside the body
 * (`createEditor({ quoted })`, `QuotedHistory`), so no template, import or
 * source edit ever replaces it.
 *
 * The history **is** the schema's blockquote — deliberately not a dedicated
 * node: our output carries no classes, so it would have no honest parse
 * discriminator against a plain blockquote (Gmail's `class="gmail_quote"`
 * drops on parse like every class). Keeping it beside the body is what
 * tells it apart.
 */
export function replyQuote(inbound: InboundMessage, options?: ComposeSeedOptions): string {
  const schema = getSchema();
  return serializeToHTML(schema.nodes['doc'].create(null, replyBlocks(inbound, schema, options)), schema);
}

/**
 * The reply as one document — an empty line to type on, then
 * {@link replyQuote}'s history *in* the body, where it is ordinary text. For
 * a host without the kept history; with it, seed the body empty and pass
 * `replyQuote` as `quoted`.
 */
export function replyDocument(inbound: InboundMessage, options?: ComposeSeedOptions): string {
  const schema = getSchema();
  const blocks = [emptyParagraph(schema), ...replyBlocks(inbound, schema, options)];
  return serializeToHTML(schema.nodes['doc'].create(null, blocks), schema);
}

function replyBlocks(inbound: InboundMessage, schema: Schema, options?: ComposeSeedOptions): Node[] {
  const blocks: Node[] = [];
  const attribution = attributionLine(inbound, options);
  if (attribution) blocks.push(textParagraph(schema, attribution));
  const quoted = inboundBlocks(inbound, schema);
  blocks.push(
    schema.nodes['blockquote'].create(null, quoted.childCount ? quoted : emptyParagraph(schema)),
  );
  return blocks;
}

/**
 * The history of a forward: the conventional forwarded-message header block
 * (only the lines whose data was supplied), a separating empty line, then
 * the inbound message **unquoted** — a forward passes the message along, it
 * doesn't comment on it. Kept beside the body like {@link replyQuote}.
 */
export function forwardQuote(inbound: InboundMessage, options?: ComposeSeedOptions): string {
  const schema = getSchema();
  return serializeToHTML(schema.nodes['doc'].create(null, forwardBlocks(inbound, schema, options)), schema);
}

/** The forward as one document — an empty line, then {@link forwardQuote}'s
    history in the body. See {@link replyDocument}. */
export function forwardDocument(inbound: InboundMessage, options?: ComposeSeedOptions): string {
  const schema = getSchema();
  const blocks = [emptyParagraph(schema), ...forwardBlocks(inbound, schema, options)];
  return serializeToHTML(schema.nodes['doc'].create(null, blocks), schema);
}

function forwardBlocks(inbound: InboundMessage, schema: Schema, options?: ComposeSeedOptions): Node[] {
  const labels = labelsOf(options);
  const blocks: Node[] = [textParagraph(schema, labels.forwarded)];
  const header: Array<[string, string | undefined]> = [
    [labels.from, inbound.from],
    [labels.date, inbound.date === undefined ? undefined : formatDate(inbound.date, options)],
    [labels.subject, inbound.subject],
    [labels.to, inbound.to],
  ];
  for (const [label, value] of header) {
    if (value) blocks.push(textParagraph(schema, `${label}: ${value}`));
  }
  blocks.push(emptyParagraph(schema));

  const content = inboundBlocks(inbound, schema);
  content.forEach((node) => blocks.push(node));
  if (!content.childCount) blocks.push(emptyParagraph(schema));
  return blocks;
}

/**
 * A body with its quoted history under it — the message as it goes out,
 * for a host that holds the two as strings (a preview, its own send). A
 * whole document keeps its head; the history lands at the end of its body.
 */
export function withQuotedHistory(html: string, quoted: string | null, options?: ParseOptions): string {
  if (!quoted) return html;
  const schema = getSchema();
  const body = parseHTML(html, schema, { mode: 'email', ...options });
  const doc = withQuoted(body.type.create({ ...body.attrs, quoted }, body.content));
  return serializeToHTML(doc, schema);
}

/** Who an answer is for: the sender, everyone on the message, or — a
    forward — nobody yet. */
export type ReplyKind = 'reply' | 'reply-all' | 'forward';

export interface ReplyEnvelopeOptions extends ComposeSeedOptions {
  /** The account's own addresses. A reply-all never copies them, and a
      reply to one's own message goes to the people it went to. */
  self?: string | readonly string[];
  /** Who the answer goes to instead of the sender — a CRM's customer, say.
      A reply-all then copies the sender with everyone else. */
  to?: readonly string[];
}

/** The envelope an answer starts with. Addresses in header form, each
    recipient once — what `[email-address-input]` holds. */
export interface ReplyEnvelope {
  to: string[];
  cc: string[];
  subject: string;
}

/**
 * Who an answer goes to and what it is called — the envelope half of the
 * seed, beside {@link replyDocument} / {@link forwardDocument}'s body. Pure;
 * pass the same options to both:
 *
 * ```ts
 * const seed = { locale, labels, self: account.email };
 * const { to, cc, subject } = replyEnvelope(inbound, 'reply-all', seed);
 * html.set(replyDocument(inbound, seed));
 * ```
 *
 * - A reply goes to `replyTo` when the message names one, else to `from`;
 *   answering one's own message, to the people it went to.
 * - A reply-all copies everyone else on the message — sender, To, Cc —
 *   never `self`, never who it is already to; one entry per address, under
 *   the first name it came with.
 * - A forward addresses nobody yet.
 * - The subject takes `labels.re` / `labels.fwd` once. A prefix of the same
 *   family the subject already carries is replaced, in any of the languages
 *   below or the host's own ("AW: Re: RE: x" → "Re: x"), numbered repeats
 *   ("Re[2]:") included; the other family's stays, so a forwarded reply
 *   reads "Fwd: Re: x", as every major client writes it.
 */
export function replyEnvelope(
  inbound: InboundMessage,
  kind: ReplyKind,
  options: ReplyEnvelopeOptions = {},
): ReplyEnvelope {
  const labels = labelsOf(options);
  if (kind === 'forward') {
    return { to: [], cc: [], subject: prefixed(inbound.subject, labels.fwd, FORWARD_PREFIXES) };
  }

  const own = new Set([options.self ?? []].flat().map(addressKey));
  const mine = (address: string) => own.has(addressKey(address));
  const to = options.to ? mailboxes(...options.to) : answerTo(inbound, mine);

  const cc: string[] = [];
  if (kind === 'reply-all') {
    const taken = new Set(to.map(addressKey));
    for (const address of mailboxes(inbound.from, inbound.to, inbound.cc)) {
      if (mine(address) || taken.has(addressKey(address))) continue;
      taken.add(addressKey(address));
      cc.push(address);
    }
  }
  return { to, cc, subject: prefixed(inbound.subject, labels.re, REPLY_PREFIXES) };
}

/** Where a reply goes: Reply-To over From — and one's own message is
    answered to the people it went to. */
function answerTo(inbound: InboundMessage, mine: (address: string) => boolean): string[] {
  const replyTo = mailboxes(inbound.replyTo);
  const sender = replyTo.length ? replyTo : mailboxes(inbound.from);
  if (sender.length && sender.every(mine)) {
    const recipients = mailboxes(inbound.to).filter((address) => !mine(address));
    if (recipients.length) return recipients;
  }
  return sender;
}

/** The mailboxes in header-form lists, each address once — what is no
    mailbox (a group's `undisclosed-recipients:;`, a bare name) dropped. */
function mailboxes(...lists: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of lists.flatMap((list) => (list ? splitAddresses(list) : []))) {
    if (!isMailbox(address) || seen.has(addressKey(address))) continue;
    seen.add(addressKey(address));
    out.push(address);
  }
  return out;
}

/** The prefixes a subject may already carry, per family. Across languages
    on purpose: mail arrives from clients in other ones, so a German "AW: "
    must recognize the "Re: " an English client left behind. English and
    German; the host's own prefix joins them. The long tail ("R:", "I:") is
    left out — short forms that also open real subjects. */
const REPLY_PREFIXES = ['re', 'aw', 'antw', 'antwort'];
const FORWARD_PREFIXES = ['fwd', 'fw', 'wg'];

/** `prefix` once, in place of the run of same-family prefixes the subject
    starts with. */
function prefixed(subject = '', prefix: string, family: readonly string[]): string {
  const own = prefix.trim().replace(/:$/, '').trim();
  const words = [...family, own].filter(Boolean).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`^(?:${words.join('|')})\\s*(?:\\[\\d+\\])?\\s*:\\s*`, 'i');
  let rest = subject.trim();
  while (pattern.test(rest)) rest = rest.replace(pattern, '');
  return prefix + rest;
}

/**
 * The imported message as the document itself — the `.eml`-drop / paste law:
 * the body parses through the email schema (full strip, which doubles as
 * sanitization) and *becomes* the document; nothing else of the message
 * survives into it. Pair with `parseEml`:
 * `html.set(importedDocument(parseEml(raw)))`.
 */
export function importedDocument(inbound: InboundMessage): string {
  const schema = getSchema();
  const blocks = inboundBlocks(inbound, schema);
  const doc = schema.nodes['doc'].create(null, blocks.childCount ? blocks : emptyParagraph(schema));
  return serializeToHTML(doc, schema);
}

/**
 * What an import will lose — the *legibility of loss* half of the import law.
 * The parse itself never reports (it just repairs); this walks the inbound
 * HTML against the schema's own parse vocabulary and says what won't survive,
 * so the host can tell the user instead of losing content silently.
 */
export interface ImportLoss {
  /** Elements whose tag the schema has no parse rule for — the element is
      removed on parse (its text content may still survive, unwrapped). */
  removedElements: number;
  /** The distinct removed tags, most frequent first. */
  removedTags: string[];
  /** Images pointing at `cid:` MIME parts — they parse in, but stay
      unresolvable until the attachments story lands. */
  inlineImages: number;
}

/** Computes the {@link ImportLoss} for an inbound message — pure, derived
    from the same HTML `importedDocument` consumes:
    `const loss = importLoss(inbound)` alongside the import, then surface it
    ("3 elements outside the schema removed (o:p, font)…"). */
export function importLoss(inbound: InboundMessage): ImportLoss {
  const none: ImportLoss = { removedElements: 0, removedTags: [], inlineImages: 0 };
  if (!inbound.html) return none;

  const known = schemaTags(getSchema());
  const dom = new DOMParser().parseFromString(inbound.html, 'text/html');
  const removedByTag = new Map<string, number>();
  let removedElements = 0;
  let inlineImages = 0;

  for (const element of Array.from(dom.body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (
      tag === 'img' &&
      (element.getAttribute('src') ?? '').trim().toLowerCase().startsWith('cid:')
    ) {
      inlineImages++;
    }
    if (!known.has(tag)) {
      removedElements++;
      removedByTag.set(tag, (removedByTag.get(tag) ?? 0) + 1);
    }
  }

  const removedTags = [...removedByTag.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  return { removedElements, removedTags, inlineImages };
}

/** Tags with a parse rule somewhere in the schema — the vocabulary of the
    repair-mode parse the import runs. tbody & friends have no rule of their
    own, but the parser walks through them and our serializer emits `<tbody>`,
    so they are structure, not loss. Preserve-only rules (which would claim
    any tag) and refusals (which drop a tag on purpose) are not vocabulary. */
let knownTags: Set<string> | undefined;
function schemaTags(schema: Schema): Set<string> {
  if (knownTags) return knownTags;
  const tags = new Set<string>(['tbody', 'thead', 'tfoot']);
  const collect = (parseDOM: unknown) => {
    for (const rule of (parseDOM as Array<{ tag?: string; ignore?: boolean }>) ?? []) {
      if (rule.ignore || ruleScope(rule as never) === 'authored') continue;
      const tag = rule.tag?.split(/[\s\[.:,>]/)[0]?.toLowerCase();
      if (tag) tags.add(tag);
    }
  };
  for (const type of Object.values(schema.nodes)) collect(type.spec.parseDOM);
  for (const type of Object.values(schema.marks)) collect(type.spec.parseDOM);
  knownTags = tags;
  return tags;
}

/** The labels' attribution for what is known — degrading gracefully when
    data is partial, empty when there is none (the quote then stands on its
    own). */
function attributionLine(inbound: InboundMessage, options?: ComposeSeedOptions): string | null {
  const date = inbound.date === undefined ? undefined : formatDate(inbound.date, options);
  return labelsOf(options).attribution({ from: inbound.from || undefined, date: date || undefined });
}

function formatDate(date: Date | string, options?: ComposeSeedOptions): string {
  if (typeof date === 'string') return date;
  return new Intl.DateTimeFormat(options?.locale ?? 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** The inbound body as schema blocks: HTML parses through the schema (the
    paste law — foreign markup is repaired, unsafe markup dies); plain text
    becomes one paragraph per line, empty lines included. */
function inboundBlocks(inbound: InboundMessage, schema: Schema): Fragment {
  if (inbound.html) return parseHTML(inbound.html, schema).content;

  const text = inbound.text ?? '';
  if (!text) return Fragment.empty;
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => (line ? textParagraph(schema, line) : emptyParagraph(schema)));
  return Fragment.from(paragraphs);
}

const emptyParagraph = (schema: Schema): Node => schema.nodes['paragraph'].createAndFill()!;

const textParagraph = (schema: Schema, text: string): Node =>
  schema.nodes['paragraph'].create(null, schema.text(text));
