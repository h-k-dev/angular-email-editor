import { Fragment, Node, Schema } from 'prosemirror-model';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';

/**
 * The inbound message a reply or forward is built from. Everything here is
 * caller-supplied **data** — the envelope (addressing, transport) stays the
 * host's; these fields exist only where they become *document content*: the
 * reply attribution line and the forwarded-message header block.
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
  /** Forward header only — never rendered by {@link replyDocument}. */
  subject?: string;
  /** Forward header only — never rendered by {@link replyDocument}. */
  to?: string;
}

export interface ComposeSeedOptions {
  /** BCP 47 locale for formatting a `Date`-typed `date`. Default `en-US`.
      A string `date` is always used verbatim — pass one for full control. */
  locale?: string;
}

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
    to:
      (parsed.to ?? [])
        .map((address) => formatAddress(address))
        .filter(Boolean)
        .join(', ') || undefined,
  };
}

function formatAddress(address: ParsedAddressLike | null | undefined): string | undefined {
  if (!address) return undefined;
  const name = address.name?.trim();
  const email = address.address?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || undefined;
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
 * Builds the seed document for a reply: an empty paragraph (typing starts
 * here, above the history), the attribution line, and the inbound message
 * wrapped in a blockquote.
 *
 * The quoted history **is** the schema's blockquote — deliberately not a
 * dedicated node: our output carries no classes, so a `quotedHistory` node
 * would have no honest parse discriminator against a plain blockquote
 * (Gmail's `class="gmail_quote"` drops on parse like every class). If a
 * collapse-history UX ever needs more, that design starts at the
 * discriminator, not here.
 */
export function replyDocument(inbound: InboundMessage, options?: ComposeSeedOptions): string {
  const schema = getSchema();
  const blocks: Node[] = [emptyParagraph(schema)];

  const attribution = attributionLine(inbound, options);
  if (attribution) blocks.push(textParagraph(schema, attribution));

  const quoted = inboundBlocks(inbound, schema);
  blocks.push(
    schema.nodes['blockquote'].create(
      null,
      quoted.childCount ? quoted : emptyParagraph(schema),
    ),
  );

  return serializeToHTML(schema.nodes['doc'].create(null, blocks), schema);
}

/**
 * Builds the seed document for a forward: an empty paragraph, the
 * conventional forwarded-message header block (only the lines whose data was
 * supplied), a separating empty line, then the inbound message **unquoted** —
 * a forward passes the message along, it doesn't comment on it.
 */
export function forwardDocument(inbound: InboundMessage, options?: ComposeSeedOptions): string {
  const schema = getSchema();
  const blocks: Node[] = [emptyParagraph(schema)];

  blocks.push(textParagraph(schema, '---------- Forwarded message ---------'));
  const header: Array<[string, string | undefined]> = [
    ['From', inbound.from],
    ['Date', inbound.date === undefined ? undefined : formatDate(inbound.date, options)],
    ['Subject', inbound.subject],
    ['To', inbound.to],
  ];
  for (const [label, value] of header) {
    if (value) blocks.push(textParagraph(schema, `${label}: ${value}`));
  }
  blocks.push(emptyParagraph(schema));

  const content = inboundBlocks(inbound, schema);
  content.forEach((node) => blocks.push(node));
  if (!content.childCount) blocks.push(emptyParagraph(schema));

  return serializeToHTML(schema.nodes['doc'].create(null, blocks), schema);
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
  const doc = schema.nodes['doc'].create(
    null,
    blocks.childCount ? blocks : emptyParagraph(schema),
  );
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
    if (tag === 'img' && (element.getAttribute('src') ?? '').trim().toLowerCase().startsWith('cid:')) {
      inlineImages++;
    }
    if (!known.has(tag)) {
      removedElements++;
      removedByTag.set(tag, (removedByTag.get(tag) ?? 0) + 1);
    }
  }

  const removedTags = [...removedByTag.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
  return { removedElements, removedTags, inlineImages };
}

/** Tags with a parse rule somewhere in the schema — the vocabulary. tbody &
    friends have no rule of their own, but the parser walks through them and
    our serializer emits `<tbody>`, so they are structure, not loss. */
let knownTags: Set<string> | undefined;
function schemaTags(schema: Schema): Set<string> {
  if (knownTags) return knownTags;
  const tags = new Set<string>(['tbody', 'thead', 'tfoot']);
  const collect = (parseDOM: unknown) => {
    for (const rule of (parseDOM as Array<{ tag?: string }>) ?? []) {
      const tag = rule.tag?.split(/[\s\[.:,>]/)[0]?.toLowerCase();
      if (tag) tags.add(tag);
    }
  };
  for (const type of Object.values(schema.nodes)) collect(type.spec.parseDOM);
  for (const type of Object.values(schema.marks)) collect(type.spec.parseDOM);
  knownTags = tags;
  return tags;
}

/** "On {date}, {from} wrote:" — degrading gracefully when data is partial,
    empty when there is none (the quote then stands on its own). */
function attributionLine(inbound: InboundMessage, options?: ComposeSeedOptions): string | null {
  const date = inbound.date === undefined ? undefined : formatDate(inbound.date, options);
  if (date && inbound.from) return `On ${date}, ${inbound.from} wrote:`;
  if (inbound.from) return `${inbound.from} wrote:`;
  if (date) return `On ${date}:`;
  return null;
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
    .map((line) =>
      line ? textParagraph(schema, line) : emptyParagraph(schema),
    );
  return Fragment.from(paragraphs);
}

const emptyParagraph = (schema: Schema): Node => schema.nodes['paragraph'].createAndFill()!;

const textParagraph = (schema: Schema, text: string): Node =>
  schema.nodes['paragraph'].create(null, schema.text(text));
