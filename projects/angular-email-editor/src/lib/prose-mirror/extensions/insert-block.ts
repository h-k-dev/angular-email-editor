import { Node } from 'prosemirror-model';
import { EditorState, Transaction } from 'prosemirror-state';

/**
 * `block` put where the selection is — `tr.replaceSelectionWith(block)`, as
 * every block's insert does: an empty line is swapped for it, a line with
 * words keeps them and the block goes under it.
 *
 * But from inside a **table cell** it goes under the table. A cell holds
 * inline content only, so a block has no place in it — and ProseMirror,
 * asked to fit one there, splits everything round the caret to make room:
 * the cell's words left behind in a table of one cell, the block, and the
 * rest of the table as a second one. A divider asked for in a cell is one
 * under the table; the table stays whole.
 *
 * The transaction is the caller's to finish (a selection, a scroll).
 */
export function insertBlock(state: EditorState, block: Node): Transaction {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') {
      return state.tr.insert($from.after(depth), block);
    }
  }
  return state.tr.replaceSelectionWith(block);
}
