import { defineNode } from '../../extension';

/**
 * The document root. `envelope` holds a parsed document's surroundings —
 * doctype, `<html>`/`<body>` attributes, the canonical head — when the source
 * carried them (see `DocumentEnvelope`); `null` for a bare body fragment, which
 * is what the composer produces on its own. Never content: the serializer
 * wraps the body in it, the editor never shows it.
 */
export const Document = defineNode({
  name: 'doc',
  topNode: true,
  spec: { content: 'block+', attrs: { envelope: { default: null } } },
});
