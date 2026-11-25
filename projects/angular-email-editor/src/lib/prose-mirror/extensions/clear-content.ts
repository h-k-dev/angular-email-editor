import { Command, EditorState, Selection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { defineExtension } from '../extension';
import { LAYOUT_EDIT_META } from '../layout-marker';

/** What an empty document holds: the schema's one empty block. */
const emptyContent = (state: EditorState): Fragment =>
  state.schema.topNodeType.createAndFill()?.content ?? Fragment.empty;

/** What a document holds besides its content, each `null` when blank: the
    page it stands in (`pageLayout`), the HTML round it (`envelope`: doctype,
    head, the `<html>` and `<body>` attributes) and the quoted history a reply
    answers (`quoted`) — where its schema has them. */
const wrappings = (state: EditorState): string[] =>
  ['pageLayout', 'envelope', 'quoted'].filter((name) => (state.doc.attrs[name] ?? null) !== null);

/** Whether there is anything to clear: something written, or anything round it. */
const hasContent = (state: EditorState): boolean =>
  !state.doc.content.eq(emptyContent(state)) || wrappings(state).length > 0;

/**
 * Clears the document — a new, blank one in its place, as a message starts:
 * the body, all of it; the page it stood in (`pageLayout`) with its rows,
 * column and colours; the HTML round it (`envelope`: doctype, head, the
 * `<html>` and `<body>` attributes — a stored template's background, font
 * and margins); and the quoted history. Nothing of what was there is left
 * in the source. One step: Mod-Z brings it all back. False on a document
 * that is blank already.
 */
export const clearContent: Command = (state, dispatch) => {
  if (!hasContent(state)) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(0, state.doc.content.size, emptyContent(state));
    for (const name of wrappings(state)) tr.setDocAttribute(name, null);
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

/** `/clear`: a blank document — content, page, envelope and quoted history gone, in one
    step — see {@link clearContent}. */
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
