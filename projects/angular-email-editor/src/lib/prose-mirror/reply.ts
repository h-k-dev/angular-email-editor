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
