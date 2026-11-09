import {
  AllSelection,
  Command,
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { Node } from 'prosemirror-model';
import { defineExtension } from '../extension';
import { LayoutBlockType } from './layout-guides';
import { tableKind } from './nodes/table';
import { LAYOUT_EDIT_META } from '../layout-marker';
import { BlockSelection } from './block-selection';

/** The layout blocks whose interaction can be switched: the guides' three,
    and the spacer, whose one gesture is its height's drag. */
export type InteractiveLayoutType = LayoutBlockType | 'spacer' | 'heading' | 'list';

/** Which layout blocks take their own interaction — grips, boundary drags,
    add pills, the block menu, a spacer's drag — by type. `table` is the
    *layout* table: a bordered or borderless one is content, not layout, and
    always takes its own ({@link layoutBlockInteractive}). */
export type LayoutInteractivity = Readonly<Record<InteractiveLayoutType, boolean>>;

/** Every layout block interactive: the editor's default. */
export const LAYOUT_INTERACTIVE: LayoutInteractivity = {
  section: true,
  columns: true,
  table: true,
  spacer: true,
  heading: true,
  list: true,
};

/** The attribute on the editor root naming the layout blocks whose
    interaction is off, space-separated (`data-aee-static="table columns"`) —
    what a stylesheet hides their affordances by: `[data-aee-static~=table]`.
    Absent while every block is interactive. */
export const LAYOUT_STATIC_ATTRIBUTE = 'data-aee-static';

/** The class a frozen text layout element wears in the editor — a layout
    heading or list whose interaction is off. Never in the email. */
export const STATIC_TEXT_CLASS = 'aee-static-text';

const layoutInteractionKey = new PluginKey<LayoutInteractivity>('layoutInteraction');

/** Whether a layout block of `type` takes its interaction in this state —
    true in an editor without the extension. */
export function layoutInteractive(state: EditorState, type: InteractiveLayoutType): boolean {
  return layoutInteractionKey.getState(state)?.[type] ?? true;
}

/** Whether this block takes its interaction in this state — what an
    affordance on one given block asks. A bordered or borderless table always
    does: only a layout table is layout ({@link tableKind}). So does any node
    that is no layout block at all. */
export function layoutBlockInteractive(state: EditorState, node: Node): boolean {
  switch (node.type.name) {
    case 'table':
      return tableKind(node) !== 'layout' || layoutInteractive(state, 'table');
    case 'columns':
    case 'section':
    case 'spacer':
      return layoutInteractive(state, node.type.name);
    // The text layout elements: the flush heading and the flush list. A
    // spaced one is the writer's own, as a content table is.
    case 'heading':
      return !node.attrs['layout'] || layoutInteractive(state, 'heading');
    case 'bulletList':
    case 'orderedList':
      return !node.attrs['layout'] || layoutInteractive(state, 'list');
    default:
      return true;
  }
}

/** Whether `node` is a text layout element — a layout heading, a layout
    list — whose interaction is off: frozen, words and all. */
function isStaticText(state: EditorState, node: Node): boolean {
  const name = node.type.name;
  if (name !== 'heading' && name !== 'bulletList' && name !== 'orderedList') return false;
  return !layoutBlockInteractive(state, node);
}

/** The frozen text layout element `pos` is in — the outermost — or null. */
export function staticTextAt(state: EditorState, pos: number): { pos: number; node: Node } | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth);
    if (isStaticText(state, node)) return { pos: $pos.before(depth), node };
  }
  return null;
}

/** Whether the selection lies wholly in frozen text: nothing it covers can
    be changed, so nothing that formats a selection has anything to do. */
export function selectionInStaticText(state: EditorState): boolean {
  const { from, to } = state.selection;
  let free = false;
  let any = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (free) return false;
    if (isStaticText(state, node)) {
      any = true;
      return false;
    }
    if (node.isTextblock) {
      // A line the range only touches at its edge holds none of it.
      const start = Math.max(from, pos + 1);
      const end = Math.min(to, pos + 1 + node.content.size);
      if (end > start || from === to) free = true;
      return false;
    }
    if (node.isLeaf) free = true;
    return true;
  });
  return any && !free;
}

/** What a static layout block must stay: its type, its own attributes and
    the bands it is made of (a columns block's columns, a layout table's rows
    and cells) — never what is written in it, nor how a cell's words are
    aligned or filled; a text layout element, everything. Null for a node
    that is no layout block (a bordered or borderless table included). */
function layoutShape(node: Node): string | null {
  const pick = (of: Node, names: string[]) => names.map((name) => of.attrs[name] ?? null);
  switch (node.type.name) {
    case 'section':
      return JSON.stringify([
        'section',
        pick(node, ['background', 'padding', 'image', 'contentBackground', 'inset', 'width']),
      ]);
    case 'spacer':
      return JSON.stringify(['spacer', pick(node, ['height', 'background'])]);
    // The text layout elements, a layout heading and a layout list, are
    // the template's own words: all of them, as written (the user,
    // 2026-11-09: "like a background, not editable").
    case 'heading':
    case 'bulletList':
    case 'orderedList':
      return node.attrs['layout'] ? JSON.stringify(node.toJSON()) : null;
    case 'columns': {
      const columns: unknown[] = [];
      node.forEach((column) =>
        columns.push(
          pick(column, ['maxWidth', 'background', 'padding', 'hold', 'gutter', 'valign']),
        ),
      );
      return JSON.stringify(['columns', pick(node, ['align']), columns]);
    }
    case 'table': {
      if (tableKind(node) !== 'layout') return null;
      const rows: unknown[] = [];
      node.forEach((row) => {
        const cells: unknown[] = [];
        row.forEach((cell) => cells.push(pick(cell, ['colspan', 'rowspan', 'colwidth'])));
        rows.push(cells);
      });
      return JSON.stringify(['table', pick(node, ['width', 'offset']), rows]);
    }
    default:
      return null;
  }
}

/** Whether `tr` leaves every static layout block of `state` standing as
    it is: each still there, in its order, the same shape. What is written
    in a section, a column or a cell, and round the blocks, is free; a new
    block may come in (a paste). */
function keepsStaticLayout(tr: Transaction, state: EditorState): boolean {
  let kept = true;
  let last = -1;
  state.doc.descendants((node, pos) => {
    if (!kept) return false;
    // Nothing below a line, a heading or a cell is a block.
    const deeper = !node.isTextblock;
    if (layoutBlockInteractive(state, node)) return deeper;
    const shape = layoutShape(node);
    if (shape === null) return deeper;
    // After anything put in at its start: the block itself, where it still
    // stands. A block taken out lands on whatever follows it — another
    // node, or the next block of the same shape, which is then met twice.
    const to = tr.mapping.map(pos, 1);
    const now = tr.doc.nodeAt(to);
    if (to <= last || !now || now.type !== node.type || layoutShape(now) !== shape) kept = false;
    last = to;
    return kept && deeper;
  });
  return kept;
}

/** Whether the lock refuses `tr` in `state` — what `filterTransaction`
    answers, the other way round. */
function refused(tr: Transaction, state: EditorState): boolean {
  if (!tr.docChanged) return false;
  if (tr.getMeta(LAYOUT_EDIT_META) || tr.getMeta('externalSync') || tr.getMeta('history$')) {
    return false;
  }
  if (Object.values(layoutInteractivity(state)).every(Boolean)) return false;
  return !keepsStaticLayout(tr, state);
}

/** The words between `from` and `to` deleted, and nothing else: every
    line, heading and cell in the range emptied of what the range covers,
    each left standing — what deleting a selection means where it crosses a
    static block. The caret lands where the first words went. Null where the
    range holds no words. */
function wordsDeleted(state: EditorState, from: number, to: number): Transaction | null {
  const ranges = wordRanges(state, from, to);
  if (!ranges.length) return null;
  const tr = state.tr;
  for (let i = ranges.length - 1; i >= 0; i--) tr.delete(ranges[i][0], ranges[i][1]);
  return tr.setSelection(TextSelection.create(tr.doc, ranges[0][0]));
}

/** What every line, heading and cell between `from` and `to` holds of
    that range, top to bottom — but for frozen text, which keeps its words. */
function wordRanges(state: EditorState, from: number, to: number): [number, number][] {
  const ranges: [number, number][] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (isStaticText(state, node)) return false;
    if (!node.isTextblock) return true;
    const start = Math.max(from, pos + 1);
    const end = Math.min(to, pos + 1 + node.content.size);
    if (end > start) ranges.push([start, end]);
    return false;
  });
  return ranges;
}

/** Whether `node` is a static layout block, or holds one. */
function holdsStatic(state: EditorState, node: Node): boolean {
  const is = (of: Node) => layoutShape(of) !== null && !layoutBlockInteractive(state, of);
  if (is(node)) return true;
  let found = false;
  node.descendants((child) => {
    if (found) return false;
    found = is(child);
    return !found && !child.isTextblock;
  });
  return found;
}

/** Selected blocks deleted where some are static: every block that is none
    and holds none goes whole, as a block selection's do; one that is or
    holds one keeps standing, emptied of its words. Null where that changes
    nothing. */
function blocksDeleted(state: EditorState, selection: BlockSelection): Transaction | null {
  const tr = state.tr;
  const blocks = selection.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const { node, pos } = blocks[i];
    if (!holdsStatic(state, node)) {
      tr.delete(pos, pos + node.nodeSize);
      continue;
    }
    const ranges = wordRanges(state, pos, pos + node.nodeSize);
    for (let r = ranges.length - 1; r >= 0; r--) tr.delete(ranges[r][0], ranges[r][1]);
  }
  if (!tr.docChanged) return null;
  return tr.setSelection(Selection.near(tr.doc.resolve(selection.from), 1));
}

/** The selection's words deleted in place of the selection itself, where
    deleting it whole would be refused (it crosses a static block) — the
    transaction, or null where the plain deletion goes through, or there is
    nothing to delete. Text, whole-document and block selections (`blocks`
    false leaves the last out: typing does nothing to selected blocks); one
    selected node, or cells, are their own gesture. */
function wordsOfLockedSelection(state: EditorState, blocks = true): Transaction | null {
  const { selection } = state;
  if (selection.empty) return null;
  const ofBlocks = selection instanceof BlockSelection;
  if (ofBlocks && !blocks) return null;
  if (!ofBlocks && !(selection instanceof TextSelection) && !(selection instanceof AllSelection)) {
    return null;
  }
  if (!refused(state.tr.deleteSelection(), state)) return null;
  return ofBlocks
    ? blocksDeleted(state, selection)
    : wordsDeleted(state, selection.from, selection.to);
}

/** Deletes the selection's words where the selection crosses a static
    block; false where there was no need. */
function deleteLockedSelection(view: EditorView): boolean {
  const tr = wordsOfLockedSelection(view.state);
  if (!tr) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** The interactivity in this state, as a whole. */
export function layoutInteractivity(state: EditorState): LayoutInteractivity {
  return layoutInteractionKey.getState(state) ?? LAYOUT_INTERACTIVE;
}

/** Turns layout blocks' interaction on or off, by type — the types left out
    keep theirs. Not an edit: nothing to undo, nothing in the email. */
export const setLayoutInteraction =
  (interactivity: Partial<LayoutInteractivity>): Command =>
  (state, dispatch) => {
    const current = layoutInteractionKey.getState(state);
    if (!current) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .setMeta(layoutInteractionKey, { ...current, ...interactivity })
          .setMeta('addToHistory', false),
      );
    }
    return true;
  };

/**
 * Layout blocks with their interaction on or off, by type — a section's
 * block menu, a columns block's boundary drags and add pills, a layout
 * table's grips, drags, pills and menus. Off, a block is laid out as it
 * stands: its words still edit like any other, but its structure takes no
 * gesture, which is what a template whose layout is settled wants (the
 * writer fills it in, the layout is the designer's). A bordered or
 * borderless table is no layout block — it is the writer's content, and
 * keeps every gesture either way.
 *
 * **Off is a lock, not only hidden controls.** The keyboard reaches a
 * structure as well as a grip does — Backspace over a selected spacer, a
 * selection across a band deleted, Tab past a layout table's last cell, a
 * block dragged away — so a transaction that would take a static block
 * out, move it, or change its shape (its own attributes, its columns, its
 * rows and cells) is refused whole (`filterTransaction`). Three kinds pass:
 * the history's (an undo goes back to what stood), the host's own sync of
 * the document (`externalSync`), and one that says it means to
 * (`LAYOUT_EDIT_META` — `replaceHTML`, a template loaded over the page).
 *
 * **Text layout elements are frozen whole** (the user, 2026-11-09: "a
 * layout marked element in writer mode is like a background, not editable,
 * not interactable"). A layout heading and a layout list (`heading`,
 * `list`) keep every word: nothing types into one, no caret stands in one
 * (it goes on past), the browser is told so (`contenteditable="false"`,
 * `STATIC_TEXT_CLASS`), and the bubble menu stays shut over a selection
 * that covers nothing else. A spaced heading or list is the writer's own.
 * What is written in a section, a column or a layout table's cell stays
 * free: those are frames, and only their structure is locked.
 *
 * **A selection across a static block still deletes — its words.** Select
 * all and Delete on a template must not do nothing: where deleting a text
 * selection whole would be refused, Backspace, Delete, a cut, typing over
 * it and a paste over it empty the lines, headings and cells it covers and
 * leave every block standing (`wordsDeleted`); what was typed or pasted
 * then goes in where the first words stood. Selected blocks
 * (`BlockSelection`) go as blocks do — whole — but for the static ones and
 * whatever holds one, which stay, emptied (`blocksDeleted`).
 *
 * Editor state, not the document's: the email is the same either way, and a
 * switch is no undo step. The affordances read it themselves, per block
 * ({@link layoutBlockInteractive}); the editor root names the static types in
 * {@link LAYOUT_STATIC_ATTRIBUTE}, for the stylesheet that draws them, and a
 * layout table's wrap says it is one (`aee-table-wrap--layout`).
 */
export const LayoutInteraction = defineExtension({
  name: 'layoutInteraction',
  commands: () => ({
    setLayoutInteraction: (interactivity: Partial<LayoutInteractivity>) =>
      setLayoutInteraction(interactivity),
  }),
  plugins: () => [
    new Plugin<LayoutInteractivity>({
      key: layoutInteractionKey,
      state: {
        init: () => LAYOUT_INTERACTIVE,
        apply: (tr, value) => tr.getMeta(layoutInteractionKey) ?? value,
      },
      filterTransaction: (tr, state) => !refused(tr, state),
      // No caret in frozen text: one that lands there (a click, an arrow)
      // goes on to the next place that takes one, the way it was heading.
      appendTransaction: (transactions, old, state) => {
        const { selection } = state;
        if (!selection.empty || !(selection instanceof TextSelection)) return null;
        if (!transactions.some((tr) => tr.selectionSet || tr.getMeta(layoutInteractionKey))) {
          return null;
        }
        const frozen = staticTextAt(state, selection.head);
        if (!frozen) return null;
        const forward = selection.head >= old.selection.head;
        // Past a run of frozen blocks, as far as it takes.
        const seek = (dir: 1 | -1): Selection | null => {
          let at = dir > 0 ? frozen.pos + frozen.node.nodeSize : frozen.pos;
          for (let guard = 0; guard < 1000; guard++) {
            const found = Selection.findFrom(state.doc.resolve(at), dir, true);
            if (!found) return null;
            const again = staticTextAt(state, found.head);
            if (!again) return found;
            at = dir > 0 ? again.pos + again.node.nodeSize : again.pos;
          }
          return null;
        };
        const next = seek(forward ? 1 : -1) ?? seek(forward ? -1 : 1);
        return next ? state.tr.setSelection(next) : null;
      },
      props: {
        // Frozen text takes no editing from the browser either, and says
        // so for a stylesheet (`aee-static-text`).
        decorations: (state) => {
          if (layoutInteractive(state, 'heading') && layoutInteractive(state, 'list')) return null;
          const frozen: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (isStaticText(state, node)) {
              frozen.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  contenteditable: 'false',
                  class: STATIC_TEXT_CLASS,
                }),
              );
              return false;
            }
            return !node.isTextblock;
          });
          return frozen.length ? DecorationSet.create(state.doc, frozen) : null;
        },
        handleKeyDown: (view, event) =>
          (event.key === 'Backspace' || event.key === 'Delete') && deleteLockedSelection(view),
        // Typed over such a selection: its words go, the text takes their
        // place.
        handleTextInput: (view, _from, _to, text) => {
          const tr = wordsOfLockedSelection(view.state, false);
          if (!tr) return false;
          view.dispatch(tr.insertText(text).scrollIntoView());
          return true;
        },
        // Pasted over it: the words go first, and the paste lands at the
        // caret they leave — whoever handles a paste finds no selection.
        handlePaste: (view) => {
          deleteLockedSelection(view);
          return false;
        },
        handleDOMEvents: {
          // A cut copies, then deletes the selection — refused here. The
          // copy is the view's own; the words go right after it.
          cut: (view) => {
            if (wordsOfLockedSelection(view.state)) {
              queueMicrotask(() => {
                if (!view.isDestroyed) deleteLockedSelection(view);
              });
            }
            return false;
          },
        },
        attributes: (state): Record<string, string> => {
          const interactivity = layoutInteractivity(state);
          const off = (Object.keys(interactivity) as InteractiveLayoutType[]).filter(
            (type) => !interactivity[type],
          );
          return off.length ? { [LAYOUT_STATIC_ATTRIBUTE]: off.join(' ') } : {};
        },
      },
    }),
  ],
});
