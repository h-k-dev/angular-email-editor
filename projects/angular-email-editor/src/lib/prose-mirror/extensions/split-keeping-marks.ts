import {
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  newlineInCode,
  splitBlock,
} from 'prosemirror-commands';
import { Command, EditorState } from 'prosemirror-state';
import { Mark } from 'prosemirror-model';
import { defineExtension } from '../extension';

/**
 * The marks active at the cursor that should *continue past a break* — dropping
 * any that opt out via `splittable: false` (e.g. `link`, so a break inside a
 * link doesn't drag it onto the next line).
 *
 * This is the single rule both break paths share: forced line breaks
 * (Shift-Enter, {@link ../nodes/hard-break}) and paragraph splits (Enter,
 * below). Formatting like font/colour/bold has no `splittable` flag, so it
 * survives — matching Gmail, where a font chosen on a bare cursor sticks for
 * the rest of the passage you type, new lines included.
 */
export function marksAcrossBreak(state: EditorState): readonly Mark[] | 0 {
  const active =
    state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks());
  // `active` is `0` at the very start of a block (no marks to carry); an empty
  // array means every active mark opted out and continuation is cleared.
  return active ? active.filter((mark) => mark.type.spec['splittable'] !== false) : active;
}

/**
 * `splitBlock` that carries the surviving marks onto the new block — the
 * `splittable`-aware sibling of prosemirror-commands' `splitBlockKeepMarks`.
 * Without this, ProseMirror's default `splitBlock` drops every mark on Enter,
 * so a font/colour set on the cursor vanishes the moment you start a new line.
 */
const splitBlockKeepingMarks: Command = (state, dispatch) =>
  splitBlock(
    state,
    dispatch &&
      ((tr) => {
        const marks = marksAcrossBreak(state);
        if (marks) tr.ensureMarks(marks);
        dispatch(tr);
      }),
  );

/**
 * Binds Enter to a mark-preserving paragraph split. Must sit *after* the list
 * and blockquote extensions in the kit (so their own Enter handling wins inside
 * those structures) and *before* {@link ../base-keymap} (whose plain
 * `splitBlock` this replaces as the fallback). Lists already keep marks via
 * `splitListItemKeepMarks`; this closes the same gap for ordinary `<div>` lines.
 */
export const SplitKeepingMarks = defineExtension({
  name: 'splitKeepingMarks',
  keymap: () => ({
    Enter: chainCommands(
      newlineInCode,
      createParagraphNear,
      liftEmptyBlock,
      splitBlockKeepingMarks,
    ),
  }),
});
