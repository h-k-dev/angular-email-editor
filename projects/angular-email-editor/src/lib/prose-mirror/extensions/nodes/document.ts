import { defineNode } from '../../extension';

/**
 * The document root. Three attributes, none of them content:
 *
 * - `envelope` holds a parsed document's surroundings — doctype,
 *   `<html>`/`<body>` attributes, the canonical head — when the source
 *   carried them (see `DocumentEnvelope`); `null` for a bare body fragment,
 *   which is what the composer produces on its own. The serializer wraps the
 *   body in it, the editor never shows it. It comes *with* content: a
 *   replacement brings its own.
 * - `quoted` holds the quoted history a reply or forward answers — canonical
 *   HTML, or `null` (see `QuotedHistory`). It stays *beside* the content: a
 *   replacement of the body never touches it; only a deliberate step does.
 * - `pageLayout` holds how the whole email stands in the window — a centred
 *   column on a page colour (see `PageLayout`), or `null`. It is written
 *   round the body and read off it, so it comes *with* content: a pasted
 *   document, the source rewritten, brings its own.
 */
export const Document = defineNode({
  name: 'doc',
  topNode: true,
  spec: {
    content: 'block+',
    attrs: {
      envelope: { default: null },
      quoted: { default: null },
      pageLayout: { default: null },
    },
  },
});

/** The document attributes that come with content — what a replacement of
    the body carries over from the new document. Every other one stays. */
export const CONTENT_ATTRS: readonly string[] = ['envelope', 'pageLayout'];
