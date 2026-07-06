import { Plugin, PluginKey } from 'prosemirror-state';
import { defineExtension } from '../extension';

/** Subtrees that are pure noise in pasted markup. `<style>` is the dangerous
    one: ProseMirror descends into unknown elements, so a pasted style block
    would land its CSS as document *text*. */
const STRIP_TAGS = new Set(['style', 'script', 'xml', 'meta', 'link', 'title', 'iframe']);

/**
 * Pre-parse cleanup for pasted HTML. Deliberately minimal: the email schema
 * already discards classes, ids, unknown tags and unknown styles on parse —
 * this only removes what would otherwise *leak through* the parse:
 *
 * - `<style>`/`<script>`/… subtrees (their text content would survive),
 * - Word's namespaced tags (`<o:p>`, `<w:sdt>`, `<v:shape>`, …),
 * - Word's fake list glyphs (`<span style="mso-list:Ignore">·&nbsp;</span>`),
 *   which would paste literal bullet characters into the text.
 *
 * Everything else — `class` soup, `mso-*` style properties, Google Docs'
 * `<b style="font-weight:normal">` wrapper — dies in the schema parse, where
 * it belongs.
 */
export function sanitizePastedHTML(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;

  for (const element of Array.from(body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (STRIP_TAGS.has(tag) || tag.includes(':')) {
      element.remove();
      continue;
    }
    const style = element.getAttribute('style');
    if (style && /mso-list\s*:\s*ignore/i.test(style)) {
      element.remove();
    }
  }

  return body.innerHTML;
}

/** Cleans clipboard HTML before it reaches the schema parse. */
export const PasteHygiene = defineExtension({
  name: 'pasteHygiene',
  plugins: () => [
    new Plugin({
      key: new PluginKey('pasteHygiene'),
      props: {
        transformPastedHTML: sanitizePastedHTML,
      },
    }),
  ],
});
