import { Command, EditorState, Selection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { defineExtension } from '../extension';
import { LAYOUT_EDIT_META } from '../layout-marker';

/** What an empty document holds: the schema's one empty block. */
const emptyContent = (state: EditorState): Fragment =>
  state.schema.topNodeType.createAndFill()?.content ?? Fragment.empty;

/** The page the document stands in (`pageLayout`), where its schema has one. */
const pageOf = (state: EditorState): unknown => state.doc.attrs['pageLayout'] ?? null;

/** Whether there is anything to clear: something written, or a page round it. */
const hasContent = (state: EditorState): boolean =>
  !state.doc.content.eq(emptyContent(state)) || pageOf(state) !== null;

/**
 * Clears the content — a new, blank one in its place: the body, all of it,
 * and the page it stood in (`pageLayout`) with it, rows, column and colours.
 * What is round the content stays: the envelope (doctype, head, the
 * `<html>` and `<body>` attributes) and the quoted history a reply answers,
 * still under the (now empty) body. One step: Mod-Z brings text and page
 * back. False on a document that is blank already.
 */
export const clearContent: Command = (state, dispatch) => {
  if (!hasContent(state)) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(0, state.doc.content.size, emptyContent(state));
    if (pageOf(state) !== null) tr.setDocAttribute('pageLayout', null);
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

/** `/clear`: the content gone, its page with it, in one step — see {@link clearContent}. */
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
      // Said out loud: a blank message's `/` menu offers no row that would
      // do nothing.
      isEnabled: hasContent,
    },
  ],
});
