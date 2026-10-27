import { Node } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { defineExtension } from '../extension';
import { isRowsPage, plainRow } from './page-layout';

/** The line a click below made, while it is still unused — its position. */
type Made = number | null;

const clickBelowKey = new PluginKey<Made>('clickBelow');

/** Whether a node is a blank line: an empty paragraph — or a plain row
    (page of rows) holding nothing but one. */
function isBlank(node: Node): boolean {
  if (node.type.name === 'paragraph') return !node.content.size;
  return (
    node.type.name === 'pageRow' &&
    !node.attrs['background'] &&
    !node.attrs['image'] &&
    node.childCount === 1 &&
    isBlank(node.firstChild!)
  );
}

/** Where the caret goes in a blank line at `pos`: in its paragraph. */
const caretIn = (node: Node, pos: number): number =>
  node.type.name === 'pageRow' ? pos + 2 : pos + 1;

/**
 * Notion's click below the last block: the caret goes onto a fresh line
 * there — the empty line already at the end, or a new one — so the next
 * thing typed goes under everything, whatever the last block is (a heading,
 * a table, an image). On a page of rows the room below the rows is outside
 * them, and the line a new row of its own (a plain one, `plainRow`): the
 * way to add one. `clientY` is the click's; a click that is not below
 * the last block is not this one, and nothing happens (`false`). So does a
 * kit without {@link ClickBelow}.
 *
 * A line it makes is on loan: left unused — the caret elsewhere while it is
 * still empty — it goes again, so clicking about never leaves blank lines in
 * the email. Anything done in it (typing, Enter, a paste) makes it the
 * writer's. Neither the loan nor its return is a step of the undo history.
 *
 * The editor calls it for its own clicks; a host gesture that takes the
 * press itself (the block marquee) calls it for a press released in place.
 */
export function clickBelow(view: EditorView, clientY: number): boolean {
  const { state } = view;
  if (!view.editable || clickBelowKey.getState(state) === undefined) return false;
  const last = state.doc.lastChild;
  if (!last) return false;
  const dom = view.nodeDOM(state.doc.content.size - last.nodeSize);
  if (!(dom instanceof Element) || clientY <= dom.getBoundingClientRect().bottom) return false;

  const end = state.doc.content.size;
  let tr: Transaction;
  if (isBlank(last)) {
    const at = end - last.nodeSize;
    tr = state.tr.setSelection(TextSelection.create(state.doc, caretIn(last, at)));
  } else {
    const line = isRowsPage(state)
      ? plainRow(state.schema)
      : state.schema.nodes['paragraph']?.createAndFill();
    if (!line) return false;
    tr = state.tr.insert(end, line);
    tr.setSelection(TextSelection.create(tr.doc, caretIn(line, end)));
    tr.setMeta(clickBelowKey, end).setMeta('addToHistory', false);
  }
  view.focus();
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * The room below the last block, Notion's way: a click there starts a line
 * ({@link clickBelow}). In the kits, ahead of the gap cursor, whose own click
 * would park a cursor below a trailing table instead.
 */
export const ClickBelow = defineExtension({
  name: 'clickBelow',
  plugins: () => [
    new Plugin<Made>({
      key: clickBelowKey,
      state: {
        init: () => null,
        apply: (tr, made) => {
          const meta = tr.getMeta(clickBelowKey) as Made | undefined;
          if (meta !== undefined) return meta;
          if (made === null || !tr.docChanged) return made;
          const line = tr.before.nodeAt(made);
          if (!line) return null;
          // Written into — typing, Enter, a paste — the line is the writer's.
          // A change anywhere else (a stream, a host's own edit) only moves it.
          let from = made;
          let to = made + line.nodeSize;
          for (const map of tr.mapping.maps) {
            let touched = false;
            map.forEach((start, end) => {
              if (start < to && end > from) touched = true;
            });
            if (touched) return null;
            from = map.map(from, 1);
            to = map.map(to, -1);
          }
          return from;
        },
      },
      appendTransaction: (_trs, _old, state) => {
        const made = clickBelowKey.getState(state);
        if (made === null || made === undefined) return null;
        const line = state.doc.nodeAt(made);
        if (!line || !isBlank(line)) {
          return state.tr.setMeta(clickBelowKey, null);
        }
        const { from, to } = state.selection;
        if (from >= made && to <= made + line.nodeSize) return null;
        // Left unused: it goes as it came, outside the undo history.
        return state.tr
          .delete(made, made + line.nodeSize)
          .setMeta(clickBelowKey, null)
          .setMeta('addToHistory', false);
      },
      props: {
        // The editor's own box below the last block — never a block, whose
        // click is the text's.
        handleClick: (view, _pos, event) =>
          event.target === view.dom && event.button === 0 && clickBelow(view, event.clientY),
      },
    }),
  ],
});
