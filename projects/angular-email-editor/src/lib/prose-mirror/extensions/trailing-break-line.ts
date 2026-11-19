import { Node } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';

/** Class on the line (the textblock) the caret is in. */
export const CARET_LINE_CLASS = 'aee-caret-line';

/** Class on an empty `<p>` kept as the source wrote it: no line in a
    client, so none in the editor but where the caret is. */
export const EMPTY_PARAGRAPH_CLASS = 'aee-empty-paragraph';

/**
 * ProseMirror's caret aids, drawn only where the caret is. Beside an inline
 * element — an image, a button, a line break — ProseMirror puts aids of its
 * own so the caret has somewhere to stand: tiny separator images
 * (`img.ProseMirror-separator`) and, at a line's end, a break of its own
 * (`br.ProseMirror-trailingBreak`). A mail client draws neither — and they
 * move the email: the break is a whole empty line after `…?<br>`, and in a
 * cell that shrinks to its content (a table's icon cell) the separators
 * are break opportunities, every piece on a line of its own.
 *
 * The host hides them on every line but the caret's, which this marks with
 * {@link CARET_LINE_CLASS} — there they stand, and the caret with them. An
 * empty line's break (its only content, what gives it its height) is never
 * an aid to hide:
 *
 *     .aee-editor img.ProseMirror-separator { display: none !important; }
 *     .aee-editor :is(br, img.ProseMirror-separator) + br.ProseMirror-trailingBreak {
 *       display: none;
 *     }
 *     .aee-editor .aee-caret-line img.ProseMirror-separator { display: inline !important; }
 *     .aee-editor .aee-caret-line
 *       :is(br, img.ProseMirror-separator) + br.ProseMirror-trailingBreak {
 *       display: inline;
 *     }
 *
 * A line that holds nothing but the editor's own widgets (a table's grips,
 * in a cell with nothing written) is still an empty line: ProseMirror puts
 * a separator after a widget as well, so its break stands behind one and
 * the rule above would take the line's height with it. That one stays:
 *
 *     .aee-editor
 *       :not(
 *         .aee-empty-paragraph,
 *         :has(> :not(.ProseMirror-widget, img.ProseMirror-separator,
 *                     br.ProseMirror-trailingBreak))
 *       )
 *       > img.ProseMirror-separator + br.ProseMirror-trailingBreak {
 *       display: inline;
 *     }
 *
 * An empty `<p>` the source wrote (`<p></p>`, kept as written) is the other
 * case: its break is ProseMirror's, not the email's, and gives it a line's
 * height a client never draws — a browser gives an empty paragraph no height
 * at all. It carries {@link EMPTY_PARAGRAPH_CLASS}, for the host to hide the
 * break there too, off the caret's line:
 *
 *     .aee-editor .aee-empty-paragraph:not(.aee-caret-line) > br.ProseMirror-trailingBreak {
 *       display: none;
 *     }
 *
 * The composer's own empty line is written with a `<br>` and is a line in
 * the email: never marked.
 *
 * The app owns the pixels, as for the layout guides.
 */
export const TrailingBreakLine = defineExtension({
  name: 'trailingBreakLine',
  plugins: () => {
    const key = new PluginKey<Decoration[]>('trailingBreakLine');
    return [
      new Plugin<Decoration[]>({
        key,
        // The empty paragraphs, found again only when the document changes.
        state: {
          init: (_, state) => emptyParagraphs(state.doc),
          apply: (tr, found) => (tr.docChanged ? emptyParagraphs(tr.doc) : found),
        },
        props: {
          decorations: (state) => {
            const marks = [...(key.getState(state) ?? []), ...caretLine(state)];
            return marks.length ? DecorationSet.create(state.doc, marks) : null;
          },
        },
      }),
    ];
  },
});

function caretLine(state: EditorState): Decoration[] {
  const { $head } = state.selection;
  const line = $head.parent;
  if (!line.isTextblock || $head.depth === 0) return [];
  const from = $head.before();
  return [Decoration.node(from, from + line.nodeSize, { class: CARET_LINE_CLASS })];
}

/** Every `<p>` kept as written with nothing in it, marked with
    {@link EMPTY_PARAGRAPH_CLASS}. */
function emptyParagraphs(doc: Node): Decoration[] {
  const marks: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'htmlTextElement' && node.attrs['tag'] === 'p' && !node.content.size) {
      marks.push(Decoration.node(pos, pos + node.nodeSize, { class: EMPTY_PARAGRAPH_CLASS }));
    }
    return !node.isTextblock;
  });
  return marks;
}
