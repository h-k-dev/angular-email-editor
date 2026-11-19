import { Node } from 'prosemirror-model';
import { EditorState, Transaction } from 'prosemirror-state';

/** A space as the text has it — typed twice, the editor writes a no-break
    space for one of them. */
const SPACE = /^[ \u00a0]$/;

/**
 * `block` put where the selection is — `tr.replaceSelectionWith(block)`, as
 * every block's insert does: an empty line is swapped for it, a line with
 * words keeps them and the block goes under it — or, with the caret between
 * its words, between the two halves of the line.
 *
 * **No space left at the cut.** The one space right before the caret and
 * the one right after it go: they stood between two words of one line, and
 * now would end one line and start the next — where HTML shows neither and
 * a reload drops both, so what was saved was not what was seen. `Hallo
 * Welt| hier` is `Hallo Welt`, the block, `hier`; and a `/divider` typed
 * after `Hallo ` leaves `Hallo`.
 *
 * **From inside a table cell** the block goes under the table. A cell holds
 * inline content only, so a block has no place in it — and ProseMirror,
 * asked to fit one there, splits everything round the caret to make room:
 * the cell's words left behind in a table of one cell, the block, and the
 * rest of the table as a second one. A divider asked for in a cell is one
 * under the table; the table stays whole, its text untouched.
 *
 * The transaction is the caller's to finish (a selection, a scroll).
 */
export function insertBlock(state: EditorState, block: Node): Transaction {
  const { $from, $to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') {
      return state.tr.insert($from.after(depth), block);
    }
  }
  const tr = state.tr;
  // The far one first: the near one's position is then still the document's.
  if (
    $to.parent.isTextblock &&
    $to.parentOffset < $to.parent.content.size &&
    SPACE.test(state.doc.textBetween($to.pos, $to.pos + 1))
  ) {
    tr.delete($to.pos, $to.pos + 1);
  }
  if (
    $from.parent.isTextblock &&
    $from.parentOffset > 0 &&
    SPACE.test(state.doc.textBetween($from.pos - 1, $from.pos))
  ) {
    tr.delete($from.pos - 1, $from.pos);
  }
  return tr.replaceSelectionWith(block);
}
