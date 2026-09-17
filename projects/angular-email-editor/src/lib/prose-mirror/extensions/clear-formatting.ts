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
  actions: () => [
    {
      id: 'clear-formatting',
      title: 'Clear formatting',
      keywords: ['clear', 'remove', 'formatting', 'plain'],
      icon: 'format_clear',
      command: clearFormatting,
      // It works on a selection. Said out loud, so a caret's `/` menu — which
      // can never have one — does not offer a row that would do nothing.
      isEnabled: (state) => !state.selection.empty,
    },
  ],
  // Gmail's binding.
  keymap: () => ({ 'Mod-\\': clearFormatting }),
});
