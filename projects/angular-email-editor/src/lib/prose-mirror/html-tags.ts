/**
 * Tag classifications shared by the source language (scanner, formatter) and
 * the preserving parser. One vocabulary, so "what is a block" never differs
 * between the pane that formats the source and the pane that parses it.
 */

/** Elements that never have content and never a closing tag. */
export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Phrasing-level containers: they lay out inline and become marks (or, when
    they wrap blocks, generic containers) in the preserving parse. */
export const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'acronym',
  'b',
  'bdi',
  'bdo',
  'big',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'tt',
  'u',
  'var',
]);

/** Void elements that lay out inline. */
export const INLINE_VOID_TAGS = new Set(['br', 'img', 'input', 'wbr']);

/** Table sections: structure the browser injects and the serializer emits on
    its own — they are walked through, never nodes of their own, wherever the
    surrounding table is canonical. */
export const TABLE_SECTION_TAGS = new Set(['tbody', 'thead', 'tfoot']);

/** Tags that make up a document's envelope rather than its content. Gmail
    strips the head anyway, so they are neither content nor a deliverability
    warning — just the envelope MJML-class tooling emits. */
export const DOCUMENT_TAGS = new Set(['html', 'head', 'body', 'title', 'meta', 'link', 'style']);

/** Never preserved, in any mode: executable or embedding content has no
    place in an email and the parse refuses it outright. */
export const REFUSED_TAGS = new Set([
  'applet',
  'base',
  'embed',
  'frame',
  'frameset',
  'iframe',
  'math',
  'object',
  'param',
  'script',
  'svg',
  'template',
]);

/** Whether an element takes part in block layout among its siblings —
    everything that is neither phrasing content nor an inline void. */
export function isBlockLevel(tag: string): boolean {
  return !INLINE_TAGS.has(tag) && !INLINE_VOID_TAGS.has(tag);
}
