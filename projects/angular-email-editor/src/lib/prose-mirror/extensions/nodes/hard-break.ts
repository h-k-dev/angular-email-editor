import { chainCommands, exitCode } from 'prosemirror-commands';
import { Command } from 'prosemirror-state';
import { Mark, Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';

/**
 * Insert a hard break at the current selection, preserving marks that
 * opt into surviving a break (mark.spec.splittable !== false).
 *
 * Marks that shouldn't continue past a forced line break — e.g. `link`,
 * since you don't want a Shift-Enter inside a link to drag the link onto
 * the next line — should set `splittable: false` on their spec. Marks
 * that never set the flag default to surviving, so this is backwards
 * compatible with anything that hasn't opted out.
 */
function insertHardBreak(schema: Schema): Command {
  return chainCommands(exitCode, (state, dispatch) => {
    const { selection, storedMarks } = state;

    // 1. Bail out early if we are inside an isolating node
    if (selection.$from.parent.type.spec.isolating) return false;

    // 2. ProseMirror will sometimes call commands without dispatch
    // just to check if they *can* be executed.
    if (dispatch) {
      // 3. Get active marks, but avoid grabbing them if we are at the very start
      // of a block (parentOffset === 0) unless they are actively stored.
      const activeMarks = storedMarks || (selection.$to.parentOffset && selection.$from.marks());

      // 4. Only keep marks that explicitly allow surviving a hard break.
      const marks = activeMarks && filterSplittableMarks(activeMarks);

      // 5. Insert the hard break
      const tr = state.tr.replaceSelectionWith(schema.nodes['hardBreak'].create());

      // 6. Re-apply the surviving marks to the cursor's new position. An empty
      // array is meaningful: it means every active mark opted out, so we
      // ensureMarks([]) to *clear* the continuation rather than let it inherit
      // them. `marks` is `Mark[] | 0`; the `0` (start-of-block) case is falsy
      // and correctly skipped.
      if (marks) tr.ensureMarks(marks);

      // 7. Execute the transaction
      dispatch(tr.scrollIntoView());
    }

    return true;
  });
}

/**
 * Drop any mark whose spec explicitly opts out via `splittable: false`.
 * Everything else — including marks that never set the flag — passes
 * through unchanged.
 */
function filterSplittableMarks(marks: readonly Mark[]): Mark[] {
  return marks.filter((mark) => mark.type.spec['splittable'] !== false);
}

export const HardBreak = defineNode({
  name: 'hardBreak',
  spec: {
    inline: true,
    group: 'inline',
    selectable: false,
    linebreakReplacement: true,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
  commands: ({ schema }) => ({
    setHardBreak: () => insertHardBreak(schema),
  }),
  keymap: ({ schema }) => ({
    'Shift-Enter': insertHardBreak(schema),
  }),
});
