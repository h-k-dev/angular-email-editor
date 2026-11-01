import { Mark, Node } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';
import { AuthoredElement, authoredMarkupOf } from '../authored';
import { isEmailAttribute, isEmailTag, unknownDeclarations } from '../email-vocabulary';
import { AttributePairs } from '../verbatim';

/**
 * What the library does not know yet, marked in the editor — never in the
 * email. The parse keeps every piece of markup as it is used (html.ts); this
 * says, where it stands, which of it the library has no model for yet, so it
 * is seen — and so the vocabulary can grow, one piece at a time.
 *
 * Two kinds:
 *
 * - **kept** — markup only the verbatim fallback holds (preserve.ts): a
 *   classed `<div>`, a `<center>`, a foreign table. It is kept as written
 *   and stays as it is; the editor has no block of its own for it yet.
 * - **unknown** — tags, attributes and CSS properties outside the email
 *   vocabulary (email-vocabulary.ts), on that markup or on our own blocks'
 *   authored markup (authored.ts): nothing a floor client is known to apply.
 *
 * Each mark carries a label for its hover — "Kept as written: <div
 * class="notion-email">", "Not known yet: style foo-bar".
 */
export interface UnknownMarkupEntry {
  from: number;
  to: number;
  kind: 'kept' | 'unknown';
  /** One line per finding, the unknown ones first. */
  label: string;
  /** A run of text (a mark), as against a node. */
  inline: boolean;
}

/** Class on every marked node or run. */
export const UNKNOWN_MARKUP_CLASS = 'aee-unknown';

/** Data attribute saying which kind — `kept` or `unknown`. */
export const UNKNOWN_MARKUP_ATTR = 'data-aee-unknown';

/** The verbatim fallback's elements (preserve.ts), which carry `{ tag, attrs }`. */
const KEPT_NODES = new Set(['htmlElement', 'htmlTextElement', 'htmlVoid', 'htmlVoidBlock']);
const KEPT_MARK = 'htmlInline';

/** Every marked piece of the document, in document order. */
export function unknownMarkup(doc: Node): UnknownMarkupEntry[] {
  const found: UnknownMarkupEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (const mark of node.marks) {
        const entry = describe(mark, KEPT_MARK);
        if (entry) found.push({ from: pos, to: pos + node.nodeSize, inline: true, ...entry });
      }
      return;
    }
    const entry = describe(node, KEPT_NODES);
    if (entry) found.push({ from: pos, to: pos + node.nodeSize, inline: false, ...entry });
  });
  return found;
}

/** What one node or mark says: kept as written, outside the vocabulary,
    both, or nothing. */
function describe(
  subject: Node | Mark,
  kept: string | Set<string>,
): { kind: 'kept' | 'unknown'; label: string } | null {
  const name = subject.type.name;
  const isKept = typeof kept === 'string' ? name === kept : kept.has(name);
  const elements: AuthoredElement[] = isKept
    ? [{ tag: subject.attrs['tag'] as string, attrs: subject.attrs['attrs'] as AttributePairs }]
    : (authoredMarkupOf(subject)?.path ?? []);
  const unknown = elements.flatMap(unknownParts);
  const lines = [
    ...(unknown.length ? [`Not known yet: ${unique(unknown).join(', ')}`] : []),
    ...(isKept ? [`Kept as written: ${openTag(elements[0])}`] : []),
  ];
  if (!lines.length) return null;
  return { kind: unknown.length ? 'unknown' : 'kept', label: lines.join('\n') };
}

/** An element's parts outside the vocabulary: its tag, its attributes, the
    properties of its style. */
function unknownParts({ tag, attrs }: AuthoredElement): string[] {
  const parts: string[] = [];
  if (tag && !isEmailTag(tag)) parts.push(`<${tag}>`);
  for (const [name, value] of attrs ?? []) {
    if (name === 'style') {
      parts.push(...unknownDeclarations(value).map((property) => `style ${property}`));
    } else if (!isEmailAttribute(name, tag)) {
      parts.push(name);
    }
  }
  return parts;
}

/** The opening tag, as far as it names the element: its class and id. */
function openTag({ tag, attrs }: AuthoredElement): string {
  const named = (attrs ?? []).filter(([name]) => name === 'class' || name === 'id');
  const said = named.map(([name, value]) => ` ${name}="${clip(value)}"`).join('');
  return `<${tag}${said}>`;
}

const clip = (value: string): string => (value.length > 40 ? `${value.slice(0, 39)}…` : value);

const unique = (values: string[]): string[] => [...new Set(values)];

const key = new PluginKey<DecorationSet>('unknownMarkup');

function decorations(doc: Node): DecorationSet {
  return DecorationSet.create(
    doc,
    unknownMarkup(doc).map(({ from, to, kind, label, inline }) => {
      const attrs = { class: UNKNOWN_MARKUP_CLASS, [UNKNOWN_MARKUP_ATTR]: kind, title: label };
      return inline ? Decoration.inline(from, to, attrs) : Decoration.node(from, to, attrs);
    }),
  );
}

/**
 * Marks what the library does not know yet ({@link unknownMarkup}) with
 * {@link UNKNOWN_MARKUP_CLASS}, {@link UNKNOWN_MARKUP_ATTR} and a `title` —
 * the editor's view only; the email never carries any of it. The app owns
 * the pixels (its global styles), as for the layout guides.
 */
export const UnknownMarkup = defineExtension({
  name: 'unknownMarkup',
  plugins: () => [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => decorations(state.doc),
        apply: (tr, previous) => (tr.docChanged ? decorations(tr.doc) : previous),
      },
      props: {
        decorations: (state) => key.getState(state),
      },
    }),
  ],
});
