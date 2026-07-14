import { chainCommands, exitCode } from 'prosemirror-commands';
import { Command } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';
import { marksAcrossBreak } from '../split-keeping-marks';

/**
 * Insert a hard break at the current selection, carrying the marks that opt
 * into surviving a break (`mark.spec.splittable !== false`) onto the new line.
 *
 * Marks that shouldn't continue past a forced line break — e.g. `link`, since
 * you don't want a Shift-Enter inside a link to drag it onto the next line —
 * set `splittable: false`. The rule is shared with the Enter/paragraph split
 * (see {@link marksAcrossBreak}) so both breaks continue formatting identically.
 */
function insertHardBreak(schema: Schema): Command {
  return chainCommands(exitCode, (state, dispatch) => {
    // Bail out early if we are inside an isolating node.
    if (state.selection.$from.parent.type.spec.isolating) return false;

    // ProseMirror sometimes calls commands without dispatch just to probe
    // whether they *can* run.
    if (dispatch) {
      const marks = marksAcrossBreak(state);
      const tr = state.tr.replaceSelectionWith(schema.nodes['hardBreak'].create());
      // Re-apply the surviving marks to the cursor's new position. An empty
      // array is meaningful: every active mark opted out, so ensureMarks([])
      // *clears* the continuation. The `0` (start-of-block) case is falsy and
      // correctly skipped.
      if (marks) tr.ensureMarks(marks);
      dispatch(tr.scrollIntoView());
    }

    return true;
  });
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
