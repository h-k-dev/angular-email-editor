import { Command, EditorState, Selection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { defineExtension } from '../extension';
import { LAYOUT_EDIT_META } from '../layout-marker';

/** What an empty document holds: the schema's one empty block. */
const emptyContent = (state: EditorState): Fragment =>
  state.schema.topNodeType.createAndFill()?.content ?? Fragment.empty;

/** Whether there is anything written to clear. */
const hasContent = (state: EditorState): boolean => !state.doc.content.eq(emptyContent(state));

/**
 * Clears what is written — the body, all of it — and nothing else: the
 * document's attributes stay, so the quoted history a reply answers is still
 * under the (now empty) body, and a page's layout is the page's still. One
 * step: Mod-Z brings the text back. False on a document that is empty
 * already.
 */
export const clearContent: Command = (state, dispatch) => {
  if (!hasContent(state)) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(0, state.doc.content.size, emptyContent(state));
    dispatch(
      tr
        .setMeta(LAYOUT_EDIT_META, true)
        .setSelection(Selection.atStart(tr.doc))
        .setStoredMarks([])
        .scrollIntoView(),
    );
  }
  return true;
};

/** `/clear`: the written content gone, in one step — see {@link clearContent}. */
export const ClearContent = defineExtension({
  name: 'clearContent',
  commands: () => ({ clearContent: () => clearContent }),
  actions: () => [
    {
      id: 'clear-content',
      section: 'message',
      title: 'Clear content',
      keywords: ['clear', 'empty', 'erase', 'delete', 'reset', 'start over'],
      icon: 'delete_sweep',
      command: clearContent,
      // Said out loud: an empty message's `/` menu offers no row that would
      // do nothing.
      isEnabled: hasContent,
    },
  ],
});
