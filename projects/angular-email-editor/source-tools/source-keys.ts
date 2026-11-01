import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import {
  FunctionalExtension,
  defineExtension,
  openTags,
  docText,
  textOffsetAt,
} from '@h-k-dev/angular-email-editor';

/** The whole lines the selection touches: where the first starts, where the
    last ends. */
function lineBlock(state: EditorState): { from: number; to: number } | null {
  const { $from, $to } = state.selection;
  if (!$from.parent.type.spec['code'] || $from.depth !== 1 || $to.depth !== 1) return null;
  return { from: $from.before(1), to: $to.after(1) };
}

/** Mod-/: the selected lines in a comment, or out of one — `<!-- -->` in
    markup, `/* *\/` inside a `<style>`. */
const toggleComment: Command = (state, dispatch) => {
  const block = lineBlock(state);
  if (!block) return false;
  const before = docText(state.doc).slice(0, textOffsetAt(state.doc, block.from + 1));
  const [open, close] = openTags(before).at(-1) === 'style' ? ['/*', '*/'] : ['<!--', '-->'];
  if (!dispatch) return true;

  const first = state.doc.resolve(block.from + 1).parent;
  const last = state.doc.resolve(block.to - 1).parent;
  const firstStart = block.from + 1;
  const lastEnd = block.to - 1;
  const lead = /^\s*/.exec(first.textContent)![0].length;
  const tr = state.tr;
  const head = first.textContent.slice(lead);
  const tail = last.textContent.trimEnd();

  if (head.startsWith(open) && tail.endsWith(close)) {
    // Out: the markers and the one space each put beside the text.
    const tailEnd = lastEnd - last.content.size + tail.length;
    const closeFrom = tailEnd - close.length - (tail.endsWith(` ${close}`) ? 1 : 0);
    tr.delete(closeFrom, tailEnd);
    const openTo = firstStart + lead + open.length + (head.startsWith(`${open} `) ? 1 : 0);
    tr.delete(firstStart + lead, openTo);
  } else {
    tr.insertText(` ${close}`, lastEnd);
    tr.insertText(`${open} `, firstStart + lead);
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** Alt-↑ / Alt-↓: the selected lines swap with the line above or below. */
const moveLines =
  (dir: -1 | 1): Command =>
  (state, dispatch) => {
    const block = lineBlock(state);
    if (!block) return false;
    const $edge = state.doc.resolve(dir < 0 ? block.from : block.to);
    const neighbour = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
    if (!neighbour) return true; // at the edge: nothing to swap with, still handled
    if (!dispatch) return true;

    const lines = state.doc.slice(block.from, block.to).content;
    const from = dir < 0 ? block.from - neighbour.nodeSize : block.from;
    const to = dir < 0 ? block.to : block.to + neighbour.nodeSize;
    const swapped =
      dir < 0 ? lines.append(Fragment.from(neighbour)) : Fragment.from(neighbour).append(lines);
    const shift = dir * neighbour.nodeSize;
    const { anchor, head } = state.selection;
    const tr = state.tr.replaceWith(from, to, swapped);
    tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
    dispatch(tr.scrollIntoView());
    return true;
  };

/** Shift-Alt-↑ / Shift-Alt-↓: the selected lines copied above or below,
    the selection on the copy below for ↓. */
const copyLines =
  (dir: -1 | 1): Command =>
  (state, dispatch) => {
    const block = lineBlock(state);
    if (!block) return false;
    if (!dispatch) return true;
    const lines = state.doc.slice(block.from, block.to).content;
    const { anchor, head } = state.selection;
    const tr = state.tr.insert(block.to, lines);
    const shift = dir > 0 ? lines.size : 0;
    tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
    dispatch(tr.scrollIntoView());
    return true;
  };

/** Mod-Shift-K: the selected lines gone, the caret on the line after. */
const deleteLines: Command = (state, dispatch) => {
  const block = lineBlock(state);
  if (!block) return false;
  if (!dispatch) return true;
  // The one line left is emptied, not removed: the document keeps a line.
  if (block.from === 0 && block.to === state.doc.content.size) {
    dispatch(state.tr.delete(1, state.doc.content.size - 1).scrollIntoView());
    return true;
  }
  const tr = state.tr.delete(block.from, block.to);
  const pos = Math.min(block.from, tr.doc.content.size - 1);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(pos + 1, 1))));
  dispatch(tr.scrollIntoView());
  return true;
};

/**
 * Opt-in line editing for the source editor, VS Code's keys: Mod-/ comments
 * the selected lines in or out, Alt-↑/↓ moves them, Shift-Alt-↑/↓ copies
 * them, Mod-Shift-K deletes them.
 */
export const createSourceKeys = (): FunctionalExtension =>
  defineExtension({
    name: 'sourceKeys',
    commands: () => ({
      toggleComment: () => toggleComment,
      moveLinesUp: () => moveLines(-1),
      moveLinesDown: () => moveLines(1),
      copyLinesUp: () => copyLines(-1),
      copyLinesDown: () => copyLines(1),
      deleteLines: () => deleteLines,
    }),
    keymap: () => ({
      'Mod-/': toggleComment,
      'Alt-ArrowUp': moveLines(-1),
      'Alt-ArrowDown': moveLines(1),
      'Shift-Alt-ArrowUp': copyLines(-1),
      'Shift-Alt-ArrowDown': copyLines(1),
      'Mod-Shift-k': deleteLines,
    }),
  });
