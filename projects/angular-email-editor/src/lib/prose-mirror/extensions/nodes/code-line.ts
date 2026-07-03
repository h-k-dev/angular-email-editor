import { Command, EditorState } from 'prosemirror-state';
import { defineNode } from '../../extension';

const INDENT_UNIT = '  ';

/** Enter keeps the current line's leading indentation on the new line. */
const splitLineKeepIndent: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'codeLine') return false;

  const indent = /^[ \t]*/.exec($from.parent.textContent)?.[0] ?? '';
  if (!dispatch) return true;

  const tr = state.tr.deleteSelection();
  tr.split(tr.selection.from);
  if (indent) tr.insertText(indent);
  dispatch(tr.scrollIntoView());
  return true;
};

/** Collects the start positions of all code lines the selection touches. */
function selectedLines(state: EditorState): number[] {
  const { from, to } = state.selection;
  const positions: number[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'codeLine') return true;
    positions.push(pos);
    return false;
  });
  return positions;
}

/** Tab: indent the selected lines, or insert an indent unit at the cursor. */
const indentLines: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.name !== 'codeLine') return false;

  if (state.selection.empty) {
    dispatch?.(state.tr.insertText(INDENT_UNIT).scrollIntoView());
    return true;
  }
  if (!dispatch) return true;

  const tr = state.tr;
  // Back to front so earlier insertions don't shift later positions.
  for (const pos of selectedLines(state).reverse()) tr.insertText(INDENT_UNIT, pos + 1);
  dispatch(tr.scrollIntoView());
  return true;
};

/** Shift-Tab: remove up to one indent unit from each selected line. */
const dedentLines: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.name !== 'codeLine') return false;
  if (!dispatch) return true;

  const tr = state.tr;
  for (const pos of selectedLines(state).reverse()) {
    const line = state.doc.nodeAt(pos);
    const leading = /^ {1,2}|^\t/.exec(line?.textContent ?? '')?.[0];
    if (leading) tr.delete(pos + 1, pos + 1 + leading.length);
  }
  if (!tr.docChanged) return true;
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * One line of source code. The document of the HTML source kit is a flat list
 * of these; the source text is the lines joined with newlines. `code: true`
 * makes ProseMirror treat pastes as plain text, and `marks: ''` keeps
 * formatting out — colour comes from decorations, not marks.
 */
export const CodeLine = defineNode({
  name: 'codeLine',
  spec: {
    content: 'text*',
    group: 'block',
    code: true,
    marks: '',
    parseDOM: [{ tag: 'div.aee-code-line', preserveWhitespace: 'full' }],
    toDOM: () => ['div', { class: 'aee-code-line' }, 0],
  },
  keymap: () => ({
    Enter: splitLineKeepIndent,
    Tab: indentLines,
    'Shift-Tab': dedentLines,
  }),
});
