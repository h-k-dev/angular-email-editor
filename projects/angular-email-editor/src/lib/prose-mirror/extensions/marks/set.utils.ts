import { EditorState, Transaction, TextSelection } from 'prosemirror-state';
import { MarkType } from 'prosemirror-model';

/**
 * A reusable, safe command to set a mark, inspired by Tiptap.
 */
export function setMark(markType: MarkType, attributes: Record<string, any> = {}) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const { selection, tr, doc } = state;
    const { empty, ranges } = selection;

    // 1. Handle the Empty Cursor State safely (Fixing your TS Error)
    if (empty) {
      if (selection instanceof TextSelection && selection.$cursor) {
        if (dispatch) {
          // You could also extract old attributes here if dealing with complex marks
          tr.addStoredMark(markType.create(attributes));
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
