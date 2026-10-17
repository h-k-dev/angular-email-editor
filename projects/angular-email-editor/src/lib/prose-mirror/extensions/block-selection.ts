import {
  AllSelection,
  Command,
  Plugin,
  PluginKey,
  Selection,
  SelectionBookmark,
} from 'prosemirror-state';
import { Node, ResolvedPos } from 'prosemirror-model';
import { Mappable } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';

/** The class every block of a {@link BlockSelection} wears — the wash the
    app paints over it, since the selection itself draws nothing. */
export const BLOCK_SELECTED_CLASS = 'aee-block--selected';

/** A selection of `anchor`..`head` when both are seams between top-level
    blocks and it holds at least one, else the nearest valid selection at
    `head` — what a mapped or restored block selection falls back to once
    its blocks are gone. */
function blocksOr(doc: Node, anchor: number, head: number): Selection {
  const $anchor = doc.resolve(anchor);
  const $head = doc.resolve(head);
  if (anchor !== head && $anchor.depth === 0 && $head.depth === 0) {
    return new BlockSelection($anchor, $head);
  }
  return Selection.near($head);
}

/** Where top-level block `index` starts. */
function blockStart(doc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

class BlockBookmark implements SelectionBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}

  map(mapping: Mappable): BlockBookmark {
    const forward = this.head > this.anchor;
    return new BlockBookmark(
      mapping.map(this.anchor, forward ? 1 : -1),
      mapping.map(this.head, forward ? -1 : 1),
    );
  }

  resolve(doc: Node): Selection {
    return blocksOr(doc, this.anchor, this.head);
  }
}

/**
 * Whole top-level blocks selected as blocks — Notion's block selection: the
 * marquee's ({@link createBlockMarquee}) and the second `Mod-a`'s.
 *
 * Its ends are seams between top-level blocks (depth 0), so it always holds
 * whole blocks, one or more, in a run: an email is one column of them, and
 * a box dragged down it covers a run. A columns block or a table is one
 * block — selected whole, never cell by cell (that is `CellSelection`).
 *
 * It copies, cuts, deletes and is pasted over as the blocks (ProseMirror's
 * own handling, through its range), and draws nothing itself: `visible` is
 * false, so the browser's highlight is hidden, and every block in it wears
 * {@link BLOCK_SELECTED_CLASS} for the app to paint (see {@link SelectedBlocks}).
 */
export class BlockSelection extends Selection {
  /** The blocks from `anchorBlock` to `headBlock`, both the positions where
      a top-level block starts; the head is the end Shift-arrows move. */
  static create(doc: Node, anchorBlock: number, headBlock = anchorBlock): BlockSelection {
    const $anchor = doc.resolve(anchorBlock);
    const $head = doc.resolve(headBlock);
    const anchorNode = $anchor.nodeAfter;
    const headNode = $head.nodeAfter;
    if ($anchor.depth !== 0 || $head.depth !== 0 || !anchorNode || !headNode) {
      throw new RangeError('BlockSelection.create takes the starts of top-level blocks');
    }
    return headBlock >= anchorBlock
      ? new BlockSelection($anchor, doc.resolve(headBlock + headNode.nodeSize))
      : new BlockSelection(doc.resolve(anchorBlock + anchorNode.nodeSize), $head);
  }

  /** Every block of the document. */
  static all(doc: Node): BlockSelection {
    return new BlockSelection(doc.resolve(0), doc.resolve(doc.content.size));
  }

  constructor($anchor: ResolvedPos, $head: ResolvedPos) {
    super($anchor, $head);
  }

  /** The selected blocks, top to bottom. */
  get blocks(): { node: Node; pos: number }[] {
    const blocks: { node: Node; pos: number }[] = [];
    this.$from.doc.nodesBetween(this.from, this.to, (node, pos) => {
      blocks.push({ node, pos });
      return false;
    });
    return blocks;
  }

  /** The first block's index and the last's among the document's blocks. */
  get indices(): { first: number; last: number } {
    return { first: this.$from.index(0), last: this.$to.index(0) - 1 };
  }

  /** The block at the head's end: the one Shift-arrows grow or shrink from. */
  get headIndex(): number {
    const { first, last } = this.indices;
    return this.head > this.anchor ? last : first;
  }

  /** The block at the anchor's end, which stays while Shift-arrows move. */
  get anchorIndex(): number {
    const { first, last } = this.indices;
    return this.head > this.anchor ? first : last;
  }

  // Each end keeps to its blocks: a block inserted at a seam of the
  // selection lands outside it.
  map(doc: Node, mapping: Mappable): Selection {
    return new BlockBookmark(this.anchor, this.head).map(mapping).resolve(doc);
  }

  eq(other: Selection): boolean {
    return (
      other instanceof BlockSelection && other.anchor === this.anchor && other.head === this.head
    );
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: 'aeeBlocks', anchor: this.anchor, head: this.head };
  }

  static override fromJSON(doc: Node, json: { anchor: unknown; head: unknown }): BlockSelection {
    if (typeof json.anchor !== 'number' || typeof json.head !== 'number') {
      throw new RangeError('Invalid input for BlockSelection.fromJSON');
    }
    const selection = blocksOr(doc, json.anchor, json.head);
    if (!(selection instanceof BlockSelection)) {
      throw new RangeError('BlockSelection.fromJSON: not a run of top-level blocks');
    }
    return selection;
  }

  override getBookmark(): SelectionBookmark {
    return new BlockBookmark(this.anchor, this.head);
  }
}

// Drawn by the app, never by the browser (`ProseMirror-hideselection`).
BlockSelection.prototype.visible = false;

Selection.jsonID('aeeBlocks', BlockSelection);

/** The one block above or below the head (ArrowUp / ArrowDown), as Notion
    walks a block selection; at the document's edge it stays. */
const stepBlocks =
  (dir: 1 | -1): Command =>
  (state, dispatch) => {
    const { selection, doc } = state;
    if (!(selection instanceof BlockSelection)) return false;
    const index = Math.min(Math.max(selection.headIndex + dir, 0), doc.childCount - 1);
    const next = BlockSelection.create(doc, blockStart(doc, index));
    if (!next.eq(selection)) dispatch?.(state.tr.setSelection(next).scrollIntoView());
    return true;
  };

/** The head moved by one block, the anchor kept (Shift-ArrowUp / -Down):
    grows the run, or shrinks it back toward the anchor. */
const extendBlocks =
  (dir: 1 | -1): Command =>
  (state, dispatch) => {
    const { selection, doc } = state;
    if (!(selection instanceof BlockSelection)) return false;
    const head = Math.min(Math.max(selection.headIndex + dir, 0), doc.childCount - 1);
    const next = BlockSelection.create(
      doc,
      blockStart(doc, selection.anchorIndex),
      blockStart(doc, head),
    );
    if (!next.eq(selection)) dispatch?.(state.tr.setSelection(next).scrollIntoView());
    return true;
  };

/** Back to text: the caret at the start of the first block (`'start'`), the
    end of the last (`'end'`), or the head's end of its block (`'head'` —
    Enter and Escape, the block you were last on). */
const leaveBlocks =
  (to: 'start' | 'end' | 'head'): Command =>
  (state, dispatch) => {
    const { selection, doc } = state;
    if (!(selection instanceof BlockSelection)) return false;
    const backward = selection.head < selection.anchor;
    const atStart = to === 'start' || (to === 'head' && backward);
    const caret = atStart
      ? Selection.near(doc.resolve(selection.from), 1)
      : Selection.near(doc.resolve(selection.to), -1);
    dispatch?.(state.tr.setSelection(caret).scrollIntoView());
    return true;
  };

/** The blocks removed — Backspace and Delete alike. */
const deleteBlocks: Command = (state, dispatch) => {
  if (!(state.selection instanceof BlockSelection)) return false;
  dispatch?.(state.tr.deleteSelection().scrollIntoView());
  return true;
};

/** `Mod-a` again: the whole document, already selected as text, selected as
    blocks. The first `Mod-a` stays the text's own select-all. */
const selectAllBlocks: Command = (state, dispatch) => {
  if (!(state.selection instanceof AllSelection)) return false;
  dispatch?.(state.tr.setSelection(BlockSelection.all(state.doc)));
  return true;
};

/** Input that would type into a block selection: typing does nothing to
    selected blocks (Notion's rule) — a paste or a drop replaces them. */
const TYPING = /^insert(?!FromPaste|FromDrop)/;

/**
 * What a {@link BlockSelection} does once there is one: every block in it
 * lit ({@link BLOCK_SELECTED_CLASS}), and Notion's keys — ArrowUp / ArrowDown
 * walk to the block above or below, Shift-ArrowUp / -Down grow or shrink the
 * run, ArrowLeft / ArrowRight leave to the caret at its start or end, Enter
 * and Escape to the caret in the head's block, Backspace / Delete remove the
 * blocks; a second `Mod-a` selects every block. Typing does nothing; a
 * paste replaces the blocks.
 *
 * In the kits: the selection is reachable by keyboard alone. The pointer's
 * way in, the marquee, is the host's to opt into ({@link createBlockMarquee}),
 * since it needs a surface around the editor to start from.
 */
export const SelectedBlocks = defineExtension({
  name: 'selectedBlocks',
  keymap: () => ({
    ArrowUp: stepBlocks(-1),
    ArrowDown: stepBlocks(1),
    'Shift-ArrowUp': extendBlocks(-1),
    'Shift-ArrowDown': extendBlocks(1),
    ArrowLeft: leaveBlocks('start'),
    ArrowRight: leaveBlocks('end'),
    Enter: leaveBlocks('head'),
    Escape: leaveBlocks('head'),
    Backspace: deleteBlocks,
    Delete: deleteBlocks,
    'Mod-a': selectAllBlocks,
  }),
  plugins: () => [
    new Plugin({
      key: new PluginKey('selectedBlocks'),
      props: {
        decorations(state) {
          const { selection } = state;
          if (!(selection instanceof BlockSelection)) return null;
          return DecorationSet.create(
            state.doc,
            selection.blocks.map(({ node, pos }) =>
              Decoration.node(pos, pos + node.nodeSize, { class: BLOCK_SELECTED_CLASS }),
            ),
          );
        },
        handleTextInput: (view) => view.state.selection instanceof BlockSelection,
        handleDOMEvents: {
          beforeinput(view, event) {
            if (!(view.state.selection instanceof BlockSelection)) return false;
            if (!TYPING.test(event.inputType)) return false;
            event.preventDefault();
            return true;
          },
        },
      },
    }),
  ],
});
