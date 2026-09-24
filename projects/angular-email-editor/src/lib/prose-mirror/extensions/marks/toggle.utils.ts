import { EditorState, NodeSelection, Transaction } from 'prosemirror-state';
import { MarkType } from 'prosemirror-model';

import { isMarkActive, selectedMarkAtom } from '../../editor';
import { setMark } from './set.utils';
import { unsetMark } from './unset.utils';

/**
 * A reusable toggle command that orchestrates set and unset.
 *
 * Active-state is delegated to {@link isMarkActive} — the exact check the
 * toolbar uses to light up its buttons — so the command and the UI can never
 * disagree. The previous `$from.marks()` test only looked at the selection's
 * left edge, so toggling a fully-marked range read it as inactive and
 * re-applied the mark instead of removing it.
 *
 * A selected atom that takes the mark as an attribute (a button, see
 * `selectedMarkAtom`) has that attribute flipped instead, and stays selected.
 */
export function toggleMark(markType: MarkType, attributes: Record<string, any> = {}) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const atom = selectedMarkAtom(state, markType);
    if (atom) {
      if (dispatch) {
        const { pos, node } = atom;
        const tr = state.tr.setNodeAttribute(pos, markType.name, node.attrs[markType.name] !== true);
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
      }
      return true;
    }
    if (isMarkActive(state, markType)) {
      return unsetMark(markType)(state, dispatch);
    }
    return setMark(markType, attributes)(state, dispatch);
  };
}
