import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';

/** Class on the line (the textblock) the caret is in. */
export const CARET_LINE_CLASS = 'aee-caret-line';

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
 * The app owns the pixels, as for the layout guides.
 */
export const TrailingBreakLine = defineExtension({
  name: 'trailingBreakLine',
  plugins: () => [
    new Plugin({
      key: new PluginKey('trailingBreakLine'),
      props: {
        decorations: (state) => caretLine(state),
      },
    }),
  ],
});

function caretLine(state: EditorState): DecorationSet | null {
  const { $head } = state.selection;
  const line = $head.parent;
  if (!line.isTextblock || $head.depth === 0) return null;
  const from = $head.before();
  return DecorationSet.create(state.doc, [
    Decoration.node(from, from + line.nodeSize, { class: CARET_LINE_CLASS }),
  ]);
}
