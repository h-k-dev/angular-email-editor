import { EditorState, Transaction, TextSelection } from 'prosemirror-state';
import { MarkType } from 'prosemirror-model';
import { isInlineAtom, markAttrsOf } from '../inline-atoms';

/**
 * A reusable, safe command to set a mark, inspired by Tiptap.
 *
 * An inline atom in the range takes no mark: one that carries the mark as
 * an attribute (a button's `bold`) has it switched on instead, and the
 * rest — an image — are left alone, the styling landing on the text
 * around them.
 */
export function setMark(markType: MarkType, attributes: Record<string, any> = {}) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { selection, tr, doc } = state;
    const { empty, ranges } = selection;

    // 1. Handle the Empty Cursor State safely (Fixing your TS Error)
    if (empty) {
      if (selection instanceof TextSelection && selection.$cursor) {
        if (dispatch) {
          // Merge with the mark about to be typed in, as a range merges below:
          // a background picked at the caret keeps the colour picked there.
          const marks = state.storedMarks ?? selection.$cursor.marks();
          const existing = marks.find((mark) => mark.type === markType);
          tr.addStoredMark(markType.create({ ...existing?.attrs, ...attributes }));
          dispatch(tr);
        }
        return true;
      }
      return false; // Not a text selection, cannot apply stored mark
    }

    // 2. Handle Selected Text (Using Tiptap's nodesBetween approach)
    let hasApplied = false;

    if (dispatch) {
      ranges.forEach((range) => {
        const { $from, $to } = range;

        doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          // Skip if it's not an inline text node
          if (!node.isInline) return true;

          if (isInlineAtom(node)) {
            if (markAttrsOf(node).includes(markType.name)) {
              if (node.attrs[markType.name] !== true) tr.setNodeAttribute(pos, markType.name, true);
              hasApplied = true;
            }
            return false;
          }

          const trimmedFrom = Math.max(pos, $from.pos);
          const trimmedTo = Math.min(pos + node.nodeSize, $to.pos);

          // Check if this node already has this mark type
          const existingMark = node.marks.find((m) => m.type === markType);

          if (existingMark) {
            // MERGE attributes (Lesson 3)
            tr.addMark(
              trimmedFrom,
              trimmedTo,
              markType.create({ ...existingMark.attrs, ...attributes }),
            );
          } else {
            // CREATE fresh mark
            tr.addMark(trimmedFrom, trimmedTo, markType.create(attributes));
          }

          hasApplied = true;
          return true; // Continue iterating
        });
      });

      if (hasApplied) {
        dispatch(tr.scrollIntoView());
      }
    } else {
      // If no dispatch is provided, the editor is just asking "CAN I run this command?"
      // We return true to light up the toolbar button.
      hasApplied = true;
    }

    return hasApplied;
  };
}
