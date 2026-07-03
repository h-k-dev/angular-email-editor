import { EditorState, Transaction } from 'prosemirror-state';
import { MarkType } from 'prosemirror-model';

/**
 * A reusable, safe command to unset a mark.
 */
export function unsetMark(markType: MarkType, attrs?: string[]) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (!dispatch) return true;

    const { selection, tr } = state;
    const { empty, ranges } = selection;

    if (!empty) {
      ranges.forEach((range) => {
        if (!attrs) {
          // Original behavior — nuke the whole mark
          tr.removeMark(range.$from.pos, range.$to.pos, markType);
        } else {
          const nulled = Object.fromEntries(attrs.map((k) => [k, null]));
          state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
            const mark = markType.isInSet(node.marks);
            if (!mark) return;
            const next = { ...mark.attrs, ...nulled };
            tr.removeMark(pos, pos + node.nodeSize, markType);
            if (!Object.values(next).every((v) => v === null)) {
              tr.addMark(pos, pos + node.nodeSize, markType.create(next));
            }
          });
        }
      });
    }

    // Stored mark (cursor) handling
    if (!attrs) {
      tr.removeStoredMark(markType);
    } else {
      const nulled = Object.fromEntries(attrs.map((k) => [k, null]));
      const stored = tr.storedMarks ?? state.selection.$from.marks();
      const current = markType.isInSet(stored);
      if (current) {
        const next = { ...current.attrs, ...nulled };
        tr.removeStoredMark(markType);
        if (!Object.values(next).every((v) => v === null)) {
          tr.addStoredMark(markType.create(next));
        }
      }
    }

    dispatch(tr.scrollIntoView());
    return true;
  };
}
