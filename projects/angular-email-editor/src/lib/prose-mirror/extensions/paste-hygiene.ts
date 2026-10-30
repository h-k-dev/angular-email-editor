import { Slice } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { defineExtension } from '../extension';
import { parseHTML } from '../html';
import { createDOMParser } from '../preserve';

/** Subtrees that are pure noise in pasted markup. `<style>` is the dangerous
    one: ProseMirror descends into unknown elements, so a pasted style block
    would land its CSS as document *text*. */
const STRIP_TAGS = new Set(['style', 'script', 'xml', 'meta', 'link', 'title', 'iframe']);

/**
 * Pre-parse cleanup for pasted HTML. Deliberately minimal: the parse keeps
 * the markup as authored and drops what no client applies — this only
 * removes what would otherwise *leak through* it:
 *
 * - `<style>`/`<script>`/… subtrees (their text content would survive),
 * - Word's namespaced tags (`<o:p>`, `<w:sdt>`, `<v:shape>`, …),
 * - Word's fake list glyphs (`<span style="mso-list:Ignore">·&nbsp;</span>`),
 *   which would paste literal bullet characters into the text.
 *
 * The clipboard's own wrapping goes with it: a browser puts every copy in an
 * `<html>` of its own, which is no head the email asked for, and Windows'
 * between `<!--StartFragment-->` and `<!--EndFragment-->`, which the email
 * would keep as comments.
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

  const comments = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const fragmentMarks: Comment[] = [];
  while (comments.nextNode()) {
    const comment = comments.currentNode as Comment;
    if (/^(?:Start|End)Fragment$/.test(comment.data.trim())) fragmentMarks.push(comment);
  }
  for (const mark of fragmentMarks) mark.remove();

  return body.innerHTML;
}

/** Whether a paste takes the whole document's place: all of it selected,
    or nothing written yet (the caret in the one empty line). */
function takesWholeDocument(state: EditorState): boolean {
  const { doc, selection } = state;
  return selection.from <= Selection.atStart(doc).from && selection.to >= Selection.atEnd(doc).to;
}

/** What every paste goes through, parsed here or not: the plugins'
    `transformPasted` (a pasted button made bare, the host's image rules). */
function pasted(view: EditorView, slice: Slice): Slice {
  view.someProp('transformPasted', (transform) => {
    slice = transform(slice, view, false);
  });
  return slice;
}

/**
 * Pasted HTML reads as the editor's content does — `parseHTML` in the
 * editor's own mode — so an email pasted in is the email loaded: kept as
 * authored, our own markup recognised (a page lifted, its rows rows, its
 * merge tags pills), and what is pasted in renders as what was copied.
 *
 * A page pasted over the whole document brings its layout along (as a
 * load does); pasted into the text, its blocks come without it.
 *
 * The editor's own copy carries its slice's open depths (`data-pm-slice`):
 * ProseMirror's paste reads those, through the same parser.
 */
export const PasteHygiene = defineExtension({
  name: 'pasteHygiene',
  plugins: ({ schema, parseMode = 'email' }) => [
    new Plugin({
      key: new PluginKey('pasteHygiene'),
      props: {
        transformPastedHTML: sanitizePastedHTML,
        clipboardParser: createDOMParser(schema, parseMode),
        handlePaste(view, event) {
          const html = event.clipboardData?.getData('text/html');
          if (!html || html.includes('data-pm-slice')) return false;
          const doc = parseHTML(sanitizePastedHTML(html), schema, { mode: parseMode });
          const { state } = view;
          const layout = doc.attrs['pageLayout'];
          const tr =
            layout && takesWholeDocument(state)
              ? state.tr
                  .replaceWith(0, state.doc.content.size, pasted(view, new Slice(doc.content, 0, 0)).content)
                  .setDocAttribute('pageLayout', layout)
              : state.tr.replaceSelection(pasted(view, Slice.maxOpen(doc.content)));
          view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
          return true;
        },
      },
    }),
  ],
});
