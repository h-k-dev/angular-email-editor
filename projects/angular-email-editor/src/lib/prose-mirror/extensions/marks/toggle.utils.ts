import { EditorState, Transaction } from 'prosemirror-state';
import { MarkType } from 'prosemirror-model';

import { isMarkActive } from '../../editor';
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
 */
export function toggleMark(markType: MarkType, attributes: Record<string, any> = {}) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (isMarkActive(state, markType)) {
      return unsetMark(markType)(state, dispatch);
    }
    return setMark(markType, attributes)(state, dispatch);
  };
}
