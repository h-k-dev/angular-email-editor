import { Command } from 'prosemirror-state';
import { defineExtension } from '../extension';

/** Strips every mark from the selection — Gmail's "remove formatting". Block
    structure (lists, quotes, alignment) is layout, not formatting: it stays. */
const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty) return false;

  if (dispatch) {
    let tr = state.tr;
    for (const type of Object.values(state.schema.marks)) {
      tr = tr.removeMark(from, to, type);
    }
    dispatch(tr.setStoredMarks([]).scrollIntoView());
  }
  return true;
};

export const ClearFormatting = defineExtension({
  name: 'clearFormatting',
  commands: () => ({ clearFormatting: () => clearFormatting }),
  // Gmail's binding.
  keymap: () => ({ 'Mod-\\': clearFormatting }),
});
