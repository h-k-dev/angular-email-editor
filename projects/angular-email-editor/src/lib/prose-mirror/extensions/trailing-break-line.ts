import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';

/** Class on the line the caret is in, while that line ends in a line break. */
export const CARET_BREAK_LINE_CLASS = 'aee-caret-break-line';

/**
 * A line that ends in a line break (`Looking for luxury skin care?<br>`)
 * draws no empty line after it in a mail client — a `<br>` closing a block
 * ends the line it is on, nothing more. ProseMirror draws one: it puts a
 * break of its own after it (`br.ProseMirror-trailingBreak`) so the caret
 * has somewhere to stand. The host hides that one, so the email looks as a
 * client draws it — on every line but the caret's, which this marks with
 * {@link CARET_BREAK_LINE_CLASS}: there the empty line is where the caret
 * stands, and typing goes on it.
 *
 *     .aee-editor br + br.ProseMirror-trailingBreak { display: none; }
 *     .aee-editor .aee-caret-break-line > br + br.ProseMirror-trailingBreak {
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
        decorations: (state) => caretBreakLine(state),
      },
    }),
  ],
});

function caretBreakLine(state: EditorState): DecorationSet | null {
  const { $head } = state.selection;
  const line = $head.parent;
  if (!line.isTextblock || line.lastChild?.type.name !== 'hardBreak') return null;
  const from = $head.before();
  return DecorationSet.create(state.doc, [
    Decoration.node(from, from + line.nodeSize, { class: CARET_BREAK_LINE_CLASS }),
  ]);
}
