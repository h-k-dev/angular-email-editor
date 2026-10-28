import { Command, EditorState, NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { DOMOutputSpec, Node, Schema } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { defineNode } from '../../extension';
import { fillTextColor } from '../../dual-contrast';
import { isSafeColor, toEmailSafeColor } from '../marks/text-style';
import { CellVerticalAlignment, parsePadding } from './table';
import { isMarked, layoutMarker, markedAs, markerAttrs } from '../../layout-marker';
import { paddingOf, paddingSides } from '../../inline-style';

/**
 * Responsive layout columns — the fluid, no-media-query answer to MJML. Each
 * column is an `inline-block` div with `width: 100%` capped by a fixed px
 * `max-width`: on a wide screen the caps let the columns sit side by side; on
 * a phone `width: 100%` wins and they stack. `box-sizing: border-box` keeps
 * the gutter padding inside the cap so the row never overflows. Outlook
 * (which ignores `inline-block`) simply stacks them — the same graceful,
 * phone-first result. All longhand + fixed px, so it round-trips deterministic.
 */
const CONTAINER_MAX = 600;

/**
 * Width the receiving client shaves off each side of the container — reading
 * pane insets, body margins, webmail card padding — before our markup sees a
 * single pixel. Unknowable and uncontrollable, so it is *budgeted*: the column
 * caps sum to `CONTAINER_MAX - 2 × this`, not to `CONTAINER_MAX`. Caps that
 * sum to the full container are a zero-slack cliff — the row stacks the moment
 * the client hands us 599px, which in practice is every client (verified
 * empirically: side-by-side at exactly 600px available, stacked at 599px).
 */
const CLIENT_PADDING_BUDGET = 20;

type ColumnsAlignment = 'left' | 'center' | 'right';

/**
 * The block's own alignment, expressed as auto margins against its `max-width`.
 *
 * Auto margins are normally the thing to distrust in email (Outlook's Word
 * engine handles them poorly), but they are *safe here by the same pairing
 * logic as `width: 100%` + `max-width`*: Outlook ignores `max-width` entirely,
 * so the container spans the full width there and has nothing to align — the
 * only clients where the cap is visible are the ones that honour auto margins.
 *
 * `left` carries **no declaration** — the same rule the email paragraph uses for
 * its default, so an unaligned block stays free of styling. Longhand only
 * (never the `margin: 0 auto` shorthand): shorthands re-serialize
 * non-deterministically through the CSSOM and break the canonical fixpoint.
 */
export const containerStyle = (align: ColumnsAlignment): string => {
  const base = `width: 100%; max-width: ${CONTAINER_MAX}px;`;
  if (align === 'center') return `${base} margin-left: auto; margin-right: auto;`;
  if (align === 'right') return `${base} margin-left: auto;`;
  return base;
};

/** Read the alignment back out of the margins — the exact inverse of
    {@link containerStyle}, so the round trip is a fixpoint. */
function parseAlignment(dom: HTMLElement): ColumnsAlignment {
  const left = dom.style?.marginLeft;
  const right = dom.style?.marginRight;
  if (left === 'auto' && right === 'auto') return 'center';
  if (left === 'auto') return 'right';
  return 'left';
}

// A filled panel always pairs its background with its text (fillTextColor) —
// explicit text survives the dark modes that flip default text but keep the fill.
// Padding is the room inside the fill — authored, or set from the column's
// menu (`setColumnPadding`); the email carries none unless asked.
const columnStyle = (
  maxWidth: number,
  background: string | null,
  padding: string | null,
  hold = false,
  valign: CellVerticalAlignment = 'top',
): string =>
  `display: inline-block; width: ${hold ? `${columnShare(maxWidth)}%` : '100%'}; max-width: ${maxWidth}px; ` +
  `vertical-align: ${valign}; box-sizing: border-box;` +
  (padding ? ` padding: ${padding};` : '') +
  (background ? ` background-color: ${background}; color: ${fillTextColor(background)};` : '');

/** The card inside a column of a block with a gap: the column's fill and
    its padding, on a div of their own. */
const cardStyle = (background: string | null, padding: string | null): string =>
  'box-sizing: border-box;' +
  (padding ? ` padding: ${padding};` : '') +
  (background ? ` background-color: ${background}; color: ${fillTextColor(background)};` : '');

/**
 * A column as the editor draws it (`editor`: its hooks, `aee-column` and
 * `aee-column__card`, beside the markers) and the email carries it (the
 * markers alone). Without a gap, one
 * div — its fill and padding its own. With one (`gutter`, the block's gap,
 * px), MJML's way to a gutter: the column carries half the gap all round as
 * a padding no fill reaches, and a card inside it (`aee-layout-card`) the
 * fill and the padding. Side by side the cards stand a gap apart, stacked
 * on a phone too — padding, never margins, so a column `width: 100%` wide
 * never runs past the screen where the head's phone rule is dropped. The
 * gap is inside each cap (`box-sizing`), so the row still fits.
 */
function columnSpec(attrs: Record<string, any>, editor: boolean): DOMOutputSpec {
  const gutter = Number(attrs['gutter']) || 0;
  const style = (background: string | null, padding: string | null) =>
    columnStyle(attrs['maxWidth'], background, padding, attrs['hold'], attrs['valign']);
  const column = editor ? { class: `aee-column ${layoutMarker('column')}` } : markerAttrs('column');
  if (!gutter) {
    return ['div', { ...column, style: style(attrs['background'], attrs['padding']) }, 0];
  }
  const card = editor ? { class: `aee-column__card ${layoutMarker('card')}` } : markerAttrs('card');
  return [
    'div',
    { ...column, style: style(null, `${gutter / 2}px`) },
    ['div', { ...card, style: cardStyle(attrs['background'], attrs['padding']) }, 0],
  ];
}

/** The card a column of a block with a gap holds — its one child, marked
    so — or null. */
function cardOf(column: HTMLElement): HTMLElement | null {
  const only = column.children.length === 1 ? column.children[0] : null;
  return only instanceof HTMLElement && only.tagName === 'DIV' && isMarked(only, 'card')
    ? only
    : null;
}

/** A column's share of the row, in whole percent — what a held column is
    wide on a phone (its cap still holds on a desktop). */
const columnShare = (maxWidth: number): number =>
  Math.max(
    1,
    Math.min(100, Math.round((maxWidth / (CONTAINER_MAX - 2 * CLIENT_PADDING_BUDGET)) * 100)),
  );

const columnMaxWidth = (count: number): number =>
  Math.floor((CONTAINER_MAX - 2 * CLIENT_PADDING_BUDGET) / count);

/**
 * The most columns a block will grow to. At 4 the even split is already down
 * to ~140px per column — enough for an icon-and-caption feature row, but the
 * floor for readable prose; a fifth would put every column below it. The cap
 * lives on the *command* (the affordance is the enforcement, like the colour
 * palette): authored markup with more columns still parses — parsing is
 * repair, not opinion.
 */
export const MAX_COLUMNS = 4;

/** No column cap below this: ~an icon-and-caption column. The boundary drag
    clamps here from both sides. */
export const MIN_COLUMN_CAP = 120;

/** Every column's px cap, in order — the block's geometry, straight from the
    model: a column's left edge is the sum of the caps before it. */
export function columnCaps(columns: Node): number[] {
  const caps: number[] = [];
  columns.forEach((column) => caps.push(column.attrs['maxWidth'] as number));
  return caps;
}

/**
 * Sets the caps of the two columns meeting at `boundary` — what the boundary
 * drag commits. `leftCap` is the left column's new cap in px; the pair's
 * total is conserved (the block's budget never changes, so a phone still
 * stacks exactly as before), and both sides clamp at {@link MIN_COLUMN_CAP}.
 * Position-addressed: the NodeView knows its block wherever the caret is.
 */
export function setColumnsBoundary(columnsPos: number, boundary: number, leftCap: number): Command {
  return (state, dispatch) => {
    const columns = state.doc.nodeAt(columnsPos);
    if (!columns || columns.type.name !== 'columns') return false;
    if (boundary < 0 || boundary >= columns.childCount - 1) return false;

    const caps = columnCaps(columns);
    const pair = caps[boundary] + caps[boundary + 1];
    if (pair < MIN_COLUMN_CAP * 2) return false;
    const left = Math.round(Math.max(MIN_COLUMN_CAP, Math.min(leftCap, pair - MIN_COLUMN_CAP)));
    const right = pair - left;

    if (dispatch) {
      const tr = state.tr;
      let pos = columnsPos + 1;
      columns.forEach((column, _offset, index) => {
        if (index === boundary || index === boundary + 1) {
          tr.setNodeMarkup(pos, null, {
            ...column.attrs,
            maxWidth: index === boundary ? left : right,
          });
        }
        pos += column.nodeSize;
      });
      dispatch(tr);
    }
    return true;
  };
}

/** The cap a column's `max-width` means: px as written; a percentage — a
    builder's share of the row (MJML's `mj-column-per-50`) — as that share
    of the budget, so two halves sit side by side exactly as two of ours.
    Not held to {@link MIN_COLUMN_CAP}: that floor is the boundary drag's —
    a builder's 2% gutter or 10% price column, widened to it, would push
    the row past the container and stack it on a desktop. */
function parseColumnMaxWidth(style: string | null): number {
  const m = /max-width:\s*(\d+(?:\.\d+)?)(px|%)/i.exec(style ?? '');
  if (!m) return columnMaxWidth(2);
  if (m[2] === 'px') return Math.round(+m[1]);
  const budget = CONTAINER_MAX - 2 * CLIENT_PADDING_BUDGET;
  return Math.max(1, Math.min(budget, Math.floor((budget * +m[1]) / 100)));
}

/** A single column: an `inline-block` div, recognised on parse by that style
    (a `<div>`, so it never collides with the inline-block button `<a>`). */
export const Column = defineNode({
  name: 'column',
  spec: {
    content: 'block+',
    isolating: true,
    // `background` fills the whole column panel — a coloured callout — from the
    // curated dual-safe palette via `setColumnBackground`. Longhand rgb(), so
    // the block stays a byte-stable fixpoint in both engines. `padding` is
    // authored only (px, via `parsePadding`) — `null` serializes none.
    attrs: {
      maxWidth: { default: columnMaxWidth(2) },
      background: { default: null },
      padding: { default: null },
      /** Holds its share of the row on a phone instead of stacking — a
          builder's grouped columns (MJML's `mj-group`), written with a
          percent `width` of their own rather than the stacking pattern's
          `width: 100%`. Emitted as that percent. */
      hold: { default: false },
      /** The block's gap, px — the same on every column of it, set for all
          at once (`setColumnsGap`): 0, the columns side by side with
          nothing between; more, each a card half of it in from its edges
          (`columnSpec`). */
      gutter: { default: 0 },
      /** Where the column's content sits beside a taller neighbour — top
          (the default), middle or bottom: `vertical-align` on the
          inline-block, and `valign` on its cell in Outlook's table
          (`outlookColumns`), the two places a client reads it. Stacked,
          a column is as tall as its content, so it means nothing there. */
      valign: { default: 'top' },
    },
    parseDOM: [
      {
        tag: 'div',
        priority: 55,
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const style = el.getAttribute('style') ?? '';
          // Marked a column (layout-marker.ts): one, whatever its display
          // says; marked as anything else, never; unmarked, by its shape.
          const kind = markedAs(el);
          if (kind && kind !== 'column') return false;
          if (!kind && !/display:\s*inline-block/i.test(style)) return false;
          // A card inside (a block with a gap, `columnSpec`): the fill and
          // the padding are the card's, the column's padding half the gap.
          const card = cardOf(el);
          const fillOf = card ?? el;
          const bg = fillOf.style?.backgroundColor;
          // The width the author wrote, before an import folded a sheet's
          // `!important` over it (`noteOwnWidths`), else the inline one.
          const own = el.getAttribute('data-aee-own-width') ?? el.style?.width ?? '';
          const share = /^(\d+(?:\.\d+)?)%$/.exec(own.trim());
          return {
            maxWidth: parseColumnMaxWidth(style),
            background: isSafeColor(bg) ? bg : null,
            padding: parsePadding(fillOf),
            gutter: card ? gutterOf(el) : 0,
            hold: !!share && +share[1] < 100,
            valign: parseColumnVerticalAlign(el),
          };
        },
        contentElement: (dom) => cardOf(dom as HTMLElement) ?? (dom as HTMLElement),
      },
    ],
    // `aee-column` (and `aee-column__card`) are editor-only CSS hooks for
    // the layout guides; `emitDOM` (serialization) drops them and keeps the
    // markers (layout-marker.ts), which the clipboard's copy carries too.
    toDOM: (node) => columnSpec(node.attrs, true),
    emitDOM: (node: { attrs: Record<string, any> }) => columnSpec(node.attrs, false),
  },
});

/** A gap off the half of it a column carries all round, px — 0 for a
    padding that is not one even half (not ours). */
function gutterOf(column: HTMLElement): number {
  const sides = parsePadding(column);
  if (!sides) return 0;
  const [top, right, bottom, left] = paddingSides(sides);
  if (!(top === right && right === bottom && bottom === left)) return 0;
  return Math.round((Number.parseFloat(top) || 0) * 2);
}

/** The column container: a plain `<div>` whose direct children are column
    divs. The child check discriminates it from an ordinary paragraph div. */
export const Columns = defineNode({
  name: 'columns',
  spec: {
    content: 'column+',
    group: 'block',
    isolating: true,
    // New blocks are centred: an email body that hugs the left of a wide screen
    // reads as broken. Parsed markup keeps whatever it authored (parsing is
    // repair, not opinion) — hence `parseAlignment` rather than this default.
    // No command or UI sets this: centre is the only option offered; the attr
    // exists solely so authored margins survive the round trip.
    attrs: { align: { default: 'center' } },
    parseDOM: [
      {
        tag: 'div',
        priority: 60,
        getAttrs: (dom) =>
          hasColumnChildren(dom as HTMLElement)
            ? { align: parseAlignment(dom as HTMLElement) }
            : false,
      },
    ],
    // Editor-only class (see the Column node) — `emitDOM` keeps the marker
    // alone.
    toDOM: (node) => [
      'div',
      {
        class: `aee-columns ${layoutMarker('columns')}`,
        style: containerStyle(node.attrs['align']),
      },
      0,
    ],
    emitDOM: (node: { attrs: Record<string, any> }) => [
      'div',
      { ...markerAttrs('columns'), style: containerStyle(node.attrs['align']) },
      0,
    ],
  },
  commands: ({ schema }) => ({
    insertColumns: (count = 2): Command => insertColumns(schema, count),
    /** Fill the column the cursor is in (or clear it with `null`). */
    setColumnBackground: (color: string | null): Command => setColumnBackground(color),
    /** Where the content of the column the cursor is in sits: top, middle,
        bottom. */
    setColumnVerticalAlign: (valign: CellVerticalAlignment): Command =>
      setColumnVerticalAlign(valign),
    /** The room inside the column the cursor is in, px — above and below
        (`block`), at its sides (`inline`). */
    setColumnPadding: (padding: ColumnPadding): Command => setColumnPadding(padding),
    /** The gap between the columns of the block the cursor is in, px. */
    setColumnsGap: (gap: number | string): Command => setColumnsGap(gap),
    // Caret-relative structural edits, for a host's own controls (the
    // block's pills use the position-addressed `appendColumn` /
    // `removeLastColumn`). Named apart from the table's
    // `addColumnAfter`/`deleteColumn` — commands merge into one flat record.
    addColumn: (): Command => addColumn,
    removeColumn: (): Command => removeColumn,
    deleteColumns: (): Command => deleteColumns,
  }),
  keymap: () => ({
    ArrowDown: escapeColumnsDown,
    // Tab walks the columns, the table's convention applied to the layout
    // block. Unbound, Tab fell through to the browser's focus navigation and
    // jumped out of the editor entirely (into the source pane, in the example
    // app) with the caret left behind — so it is claimed for the whole block,
    // even where there is nowhere left to go.
    Tab: columnTab(1),
    'Shift-Tab': columnTab(-1),
  }),
  // A plugin keymap (ahead of the gap cursor's) so a horizontal arrow at a
  // column's edge hops straight into the neighbouring column — the layout
  // twin of the table's cell-to-cell arrows. Mod-A is the table's scoped
  // select-all applied here: column content first, block from an empty
  // column, the stock whole-document one from the block selection on. And
  // Delete over whole columns removes them — the block's only delete.
  plugins: () => [
    keymap({
      ArrowLeft: columnArrow(-1),
      ArrowRight: columnArrow(1),
      'Mod-a': selectColumnContent,
      Backspace: deleteFullySelectedColumns,
      'Mod-Backspace': deleteFullySelectedColumns,
      Delete: deleteFullySelectedColumns,
      'Mod-Delete': deleteFullySelectedColumns,
    }),
  ],
  actions: ({ schema }) => [
    {
      id: 'columns',
      section: 'layout',
      title: 'Columns',
      keywords: ['columns', 'column', 'layout', 'grid', 'side by side'],
      icon: 'view_column',
      command: insertColumns(schema, 2),
    },
    {
      id: '3-columns',
      section: 'layout',
      title: '3 columns',
      keywords: ['columns', 'three', 'layout'],
      icon: 'view_column',
      command: insertColumns(schema, 3),
    },
  ],
});

function hasColumnChildren(dom: HTMLElement): boolean {
  // Marked (layout-marker.ts): a columns block is one; marked as anything
  // else, never. Unmarked: by a child that is a column — marked, or shaped.
  const kind = markedAs(dom);
  if (kind) return kind === 'columns';
  for (const child of Array.from(dom.children)) {
    if (child.tagName !== 'DIV') continue;
    const childKind = markedAs(child);
    if (childKind === 'column') return true;
    if (!childKind && /display:\s*inline-block/i.test(child.getAttribute('style') ?? '')) {
      return true;
    }
  }
  return false;
}

/** How many empty lines a fresh column starts with. Two, not one: the block
    has no padding of the editor's own, so a one-line column is a sliver the
    eye reads as a stray rule rather than a place to write — two lines give
    it the shape of a column, the way /table starts with rows to fill. */
export const COLUMN_STARTING_LINES = 2;

/** An empty column, {@link COLUMN_STARTING_LINES} lines tall. */
function freshColumn(schema: Schema, attrs: Record<string, unknown> | null = null): Node {
  const lines = Array.from({ length: COLUMN_STARTING_LINES }, () =>
    schema.nodes['paragraph'].createAndFill()!,
  );
  return schema.nodes['column'].create(attrs, lines);
}

/** Inserts an n-column block and drops the cursor into the first column. */
function insertColumns(schema: Schema, count: number): Command {
  return (state, dispatch) => {
    // Asked, not told: answer before building anything — a toolbar asks on
    // every transaction.
    if (!dispatch) return true;
    const columnsType = schema.nodes['columns'];
    const maxWidth = columnMaxWidth(count);
    const columns = Array.from({ length: count }, () => freshColumn(schema, { maxWidth }));
    const node = columnsType.create(null, columns);

    const from = state.selection.from;
    const tr = state.tr.replaceSelectionWith(node);
    let pos = -1;
    tr.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.type.name === 'columns' && p >= from - 1) pos = p;
      return pos === -1;
    });
    if (pos >= 0) {
      // columns(pos) → column(+1) → first block(+1) → inline start(+1)
      tr.setSelection(TextSelection.create(tr.doc, pos + 3));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** ArrowDown from the end of a column's last block escapes to a paragraph
    below the columns block, creating one when it is the last node — so you
    can always write underneath (mirrors the table's escape). */
const escapeColumnsDown: Command = (state, dispatch) => {
  const { $from } = state.selection;
  let columnDepth = -1;
  let columnsDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'column' && columnDepth < 0) columnDepth = d;
    if ($from.node(d).type.name === 'columns') {
      columnsDepth = d;
      break;
    }
  }
  if (columnsDepth < 0 || columnDepth < 0) return false;

  const column = $from.node(columnDepth);
  if ($from.index(columnDepth) !== column.childCount - 1) return false; // not the last block
  if ($from.parentOffset !== $from.parent.content.size) return false; // not at its end

  const columnsEnd = $from.before(columnsDepth) + $from.node(columnsDepth).nodeSize;
  if (state.doc.resolve(columnsEnd).nodeAfter) return false; // a block already follows

  if (dispatch) {
    const paragraph = state.schema.nodes['paragraph'].createAndFill();
    if (!paragraph) return false;
    const tr = state.tr.insert(columnsEnd, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, columnsEnd + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Exposed for the app to detect when the cursor is inside a columns block. */
export function findColumnsContext(state: EditorState): { pos: number; node: Node } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'columns') {
      return { pos: $from.before(d), node: $from.node(d) };
    }
  }
  return null;
}

/** The single `column` enclosing the selection (the innermost, if nested).
    Exposed so the app can route a fill to the column the cursor sits in. */
export function findColumnContext(state: EditorState): { pos: number; node: Node } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'column') {
      return { pos: $from.before(d), node: $from.node(d) };
    }
  }
  return null;
}

/** The columns block around the cursor plus which column the cursor is in —
    the structural-edit sibling of {@link findColumnsContext}. */
function findColumnsEditContext(
  state: EditorState,
): { pos: number; node: Node; index: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'columns') {
      return { pos: $from.before(d), node: $from.node(d), index: $from.index(d) };
    }
  }
  return null;
}

/** Rebuilds the block with every column's cap re-split to the even budgeted
    share — a structure change re-derives the geometry from the new count, so
    an authored asymmetric cap does not survive it (rebuilding is repair).
    Backgrounds and content are kept. */
function resplitColumns(columns: Node[], count: number): Node[] {
  const maxWidth = columnMaxWidth(count);
  return columns.map((col) => col.type.create({ ...col.attrs, maxWidth }, col.content));
}

/** Inserts an empty column after the cursor's, up to {@link MAX_COLUMNS};
    every cap re-splits evenly and the cursor lands in the new column. */
export const addColumn: Command = (state, dispatch) => {
  const ctx = findColumnsEditContext(state);
  if (!ctx || ctx.node.childCount >= MAX_COLUMNS) return false;
  if (!dispatch) return true;

  const count = ctx.node.childCount + 1;
  const existing: Node[] = [];
  ctx.node.forEach((col) => existing.push(col));
  const columns = resplitColumns(existing, count);
  const fresh = freshColumn(state.schema, {
    maxWidth: columnMaxWidth(count),
    gutter: ctx.node.firstChild?.attrs['gutter'] ?? 0,
  });
  columns.splice(ctx.index + 1, 0, fresh);

  const tr = state.tr.replaceWith(
    ctx.pos,
    ctx.pos + ctx.node.nodeSize,
    ctx.node.type.create(ctx.node.attrs, columns),
  );
  // The fresh column starts after the block's opening token (+1) and every
  // column kept before it; +2 more enters the column and its first block.
  let pos = ctx.pos + 1;
  for (let i = 0; i <= ctx.index; i++) pos += columns[i].nodeSize;
  tr.setSelection(TextSelection.create(tr.doc, pos + 2));
  dispatch(tr.scrollIntoView());
  return true;
};

/** Deletes the cursor's column and re-splits the rest evenly. Refuses on the
    last column — emptying the block is {@link deleteColumns}' job, on its own
    explicit affordance (mirrors the table's deleteRow/deleteTable split). */
export const removeColumn: Command = (state, dispatch) => {
  const ctx = findColumnsEditContext(state);
  if (!ctx || ctx.node.childCount <= 1) return false;
  if (!dispatch) return true;

  const kept: Node[] = [];
  ctx.node.forEach((col, _offset, index) => {
    if (index !== ctx.index) kept.push(col);
  });
  const tr = state.tr.replaceWith(
    ctx.pos,
    ctx.pos + ctx.node.nodeSize,
    ctx.node.type.create(ctx.node.attrs, resplitColumns(kept, kept.length)),
  );
  // Map the cursor through the rebuild, then snap to the nearest valid spot.
  const mapped = Math.min(tr.mapping.map(state.selection.from), tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(mapped)));
  dispatch(tr.scrollIntoView());
  return true;
};

/** Deletes the whole columns block (the table's `deleteTable` sibling). */
export const deleteColumns: Command = (state, dispatch) => {
  const ctx = findColumnsContext(state);
  if (!ctx) return false;
  dispatch?.(state.tr.delete(ctx.pos, ctx.pos + ctx.node.nodeSize).scrollIntoView());
  return true;
};

/** Restructures the columns block at `pos` in place: drops the columns
    `keep` refuses, optionally appends an empty one, and re-splits every cap
    evenly. Step by step — never a whole-block replace — so the selection
    maps through untouched: a caret in a kept column stays exactly where it
    was, one in a removed column lands at the nearest valid spot. The pills'
    and the select-to-delete gesture's shared tail. */
function restructureColumns(
  state: EditorState,
  pos: number,
  block: Node,
  keep: (index: number) => boolean,
  append = false,
) {
  const tr = state.tr;
  const starts: number[] = [];
  let at = pos + 1;
  block.forEach((col) => {
    starts.push(at);
    at += col.nodeSize;
  });
  // Back to front, so the earlier starts stay valid.
  for (let index = block.childCount - 1; index >= 0; index--) {
    if (!keep(index)) tr.delete(starts[index], starts[index] + block.child(index).nodeSize);
  }
  if (append) {
    const end = tr.mapping.map(pos + block.nodeSize - 1, -1);
    // The block's gap is every column's: the new one takes it too.
    tr.insert(end, freshColumn(state.schema, { gutter: block.firstChild?.attrs['gutter'] ?? 0 }));
  }
  const rebuilt = tr.doc.nodeAt(pos)!;
  const maxWidth = columnMaxWidth(rebuilt.childCount);
  rebuilt.forEach((col, offset) => {
    tr.setNodeMarkup(pos + 1 + offset, undefined, { ...col.attrs, maxWidth });
  });
  return tr;
}

/** The `+` pill on the block's right flank: an empty column after the last,
    up to {@link MAX_COLUMNS}; every cap re-splits evenly. Addressed by the
    block's position, not the caret — the pill acts on the block it is on. */
export function appendColumn(pos: number): Command {
  return (state, dispatch) => {
    const block = state.doc.nodeAt(pos);
    if (block?.type.name !== 'columns' || block.childCount >= MAX_COLUMNS) return false;
    dispatch?.(restructureColumns(state, pos, block, () => true, true));
    return true;
  };
}

/** The `−` pill on the block's left flank: the last column goes — the `+`'s
    exact inverse — and the rest re-split evenly. Refuses on the last one
    left: the block itself goes by selecting it whole and pressing Delete. */
export function removeLastColumn(pos: number): Command {
  return (state, dispatch) => {
    const block = state.doc.nodeAt(pos);
    if (block?.type.name !== 'columns' || block.childCount <= 1) return false;
    dispatch?.(restructureColumns(state, pos, block, (index) => index < block.childCount - 1));
    return true;
  };
}

/**
 * Backspace/Delete with whole columns selected — the table's gesture on the
 * layout block: select a column's content end to end (Mod-A in it, or a
 * drag) and the column goes; select several whole columns and they go;
 * select every column and the block goes. Anything less falls through to
 * the ordinary delete, which clears the selected text.
 */
const deleteFullySelectedColumns: Command = (state, dispatch) => {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return false;
  const { $from, $to } = selection;
  let depth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'columns') {
      depth = d;
      break;
    }
  }
  if (depth < 0 || $to.depth < depth || $to.before(depth) !== $from.before(depth)) return false;

  const block = $from.node(depth);
  const pos = $from.before(depth);
  const first = $from.index(depth);
  const last = $to.index(depth);
  // Whole columns: the selection starts where the first column's text starts
  // and ends where the last column's text ends.
  const start = (index: number) => {
    let at = pos + 1;
    for (let i = 0; i < index; i++) at += block.child(i).nodeSize;
    return at;
  };
  const textStart = Selection.findFrom(state.doc.resolve(start(first) + 1), 1, true);
  const textEnd = Selection.findFrom(
    state.doc.resolve(start(last) + block.child(last).nodeSize - 1),
    -1,
    true,
  );
  if (!textStart || !textEnd || $from.pos > textStart.from || $to.pos < textEnd.to) return false;

  if (!dispatch) return true;
  if (first === 0 && last === block.childCount - 1) {
    dispatch(state.tr.delete(pos, pos + block.nodeSize).scrollIntoView());
    return true;
  }
  const keep = (index: number) => index < first || index > last;
  dispatch(restructureColumns(state, pos, block, keep).scrollIntoView());
  return true;
};

/**
 * Tab / Shift-Tab inside a columns block: move to the next / previous column,
 * and past the block's ends hand off to the surrounding blocks. Always claims
 * the key while the caret is inside the block — an unclaimed Tab in a
 * contenteditable moves *browser focus*, which yanks the user out of the
 * editor mid-edit.
 */
function columnTab(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const ctx = findColumnsEditContext(state);
    if (!ctx) return false;

    const index = ctx.index + dir;
    if (index >= 0 && index < ctx.node.childCount) {
      let pos = ctx.pos + 1;
      for (let i = 0; i < index; i++) pos += ctx.node.child(i).nodeSize;
      // Enter at the column's near edge: its start going forward, its end
      // coming back — the same feel as tabbing across table cells.
      const inside = dir > 0 ? pos + 1 : pos + ctx.node.child(index).nodeSize - 1;
      dispatch?.(
        state.tr.setSelection(Selection.near(state.doc.resolve(inside), dir)).scrollIntoView(),
      );
      return true;
    }

    const from = dir > 0 ? ctx.pos + ctx.node.nodeSize : ctx.pos;
    const outside = Selection.findFrom(state.doc.resolve(from), dir, true);
    if (outside) {
      dispatch?.(state.tr.setSelection(outside).scrollIntoView());
      return true;
    }
    // Tabbing out of the last column of a trailing block: write a paragraph
    // to land in, the same courtesy ArrowDown already extends (a dead-ended
    // Tab would just look like the key stopped working).
    if (dir > 0 && dispatch) {
      const paragraph = state.schema.nodes['paragraph'].createAndFill();
      if (paragraph) {
        const tr = state.tr.insert(from, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        dispatch(tr.scrollIntoView());
      }
    }
    return true;
  };
}

/** ArrowLeft/Right at a column's outer edge (the start of its first block,
    the end of its last): move into the neighbouring column — or out of the
    block at its ends. Anywhere else the browser keeps the key. */
function columnArrow(dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const selection = state.selection;
    if (!(selection instanceof TextSelection)) return false;
    const { $head } = selection;
    let depth = -1;
    for (let d = $head.depth; d > 0; d--) {
      if ($head.node(d).type.name === 'column') {
        depth = d;
        break;
      }
    }
    if (depth < 0) return false;
    // At the column's edge: the caret's block is the column's first/last child
    // and the caret is at that block's own edge.
    const column = $head.node(depth);
    const index = $head.index(depth);
    if (dir > 0 ? index !== column.childCount - 1 : index !== 0) return false;
    if (!view.endOfTextblock(dir > 0 ? 'right' : 'left')) return false;

    const from = dir > 0 ? $head.after(depth) : $head.before(depth);
    const target = Selection.findFrom(state.doc.resolve(from), dir, true);
    if (!target) return false;
    dispatch?.(state.tr.setSelection(target).scrollIntoView());
    return true;
  };
}

/** Mod-A with the caret in a column: select that column's content — or, from
    an *empty* column, the whole columns block (whose Delete removes it) — and
    stop. The table's scoped select-all applied to the layout block; from the
    block selection the key falls through to the stock whole-document one. */
const selectColumnContent: Command = (state, dispatch) => {
  const selection = state.selection;
  if (!(selection instanceof TextSelection)) return false;
  const { $from } = selection;
  let depth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'column') {
      depth = d;
      break;
    }
  }
  if (depth < 0) return false;

  const column = $from.node(depth);
  // Empty: nothing but blank lines (a fresh column has two).
  let empty = true;
  column.forEach((block) => {
    if (!block.isTextblock || block.childCount > 0) empty = false;
  });
  if (dispatch) {
    if (empty) {
      dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(depth - 1))));
    } else {
      const $start = state.doc.resolve($from.start(depth));
      const $end = state.doc.resolve($from.end(depth));
      dispatch(state.tr.setSelection(TextSelection.between($start, $end)));
    }
  }
  return true;
};

/** A column's vertical alignment off its markup: `middle` or `bottom` as
    written, anything else — `top`, a builder's `baseline`, none — top. */
function parseColumnVerticalAlign(el: HTMLElement): CellVerticalAlignment {
  const align = (el.style?.verticalAlign ?? '').trim().toLowerCase();
  return align === 'middle' || align === 'bottom' ? align : 'top';
}

/** Sets where the content of the `column` the cursor is in sits beside a
    taller neighbour (top, middle, bottom). */
export function setColumnVerticalAlign(valign: CellVerticalAlignment): Command {
  return (state, dispatch) => {
    const ctx = findColumnContext(state);
    if (!ctx) return false;
    if (dispatch) {
      dispatch(state.tr.setNodeMarkup(ctx.pos, undefined, { ...ctx.node.attrs, valign }));
    }
    return true;
  };
}

/** The room a column's menu sets moves on the app's grid: 4px steps. */
export const COLUMN_SPACING_STEP = 4;

/** The most room inside a column — a third of the narrowest column's cap,
    the rest still its content's. */
export const COLUMN_PADDING_MAX = 40;

/** The widest gap between columns. */
export const COLUMNS_GAP_MAX = 40;

/** The room inside a column, px: above and below, and at its sides. */
export interface ColumnPadding {
  block?: number | string;
  inline?: number | string;
}

/** A length typed into a column's menu, on the grid and in range — null
    for one that is no number. */
export function columnSpacingStep(value: unknown, max: number): number | null {
  const raw = typeof value === 'string' && !value.trim() ? NaN : Number(value);
  if (!Number.isFinite(raw)) return null;
  const snapped = Math.round(raw / COLUMN_SPACING_STEP) * COLUMN_SPACING_STEP;
  return Math.min(max, Math.max(0, snapped));
}

/** The room inside the column the cursor is in, px — its top side (the
    menu sets the bottom alike) and its left (the right alike). Null where
    the cursor is in no column. */
export function columnPaddingOf(state: EditorState): { block: number; inline: number } | null {
  const ctx = findColumnContext(state);
  if (!ctx) return null;
  const [top, , , left] = paddingSides(ctx.node.attrs['padding'] ?? '0px');
  return { block: Number.parseFloat(top) || 0, inline: Number.parseFloat(left) || 0 };
}

/** Sets the room inside the column the cursor is in — inside its fill, on
    every client but Outlook's Word engine, which reads no padding on a div
    and shows the content at the fill's edge. A side left out keeps what it
    was; a length off the grid snaps to it; no room at all writes none. */
export function setColumnPadding({ block, inline }: ColumnPadding): Command {
  return (state, dispatch) => {
    const ctx = findColumnContext(state);
    if (!ctx) return false;
    const [top, right, bottom, left] = paddingSides(ctx.node.attrs['padding'] ?? '0px');
    const blockPx = block == null ? null : columnSpacingStep(block, COLUMN_PADDING_MAX);
    const inlinePx = inline == null ? null : columnSpacingStep(inline, COLUMN_PADDING_MAX);
    const side = (was: string, px: number | null) => (px == null ? was : `${px}px`);
    const sides = [
      side(top, blockPx),
      side(right, inlinePx),
      side(bottom, blockPx),
      side(left, inlinePx),
    ];
    const padding = sides.every((value) => !Number.parseFloat(value)) ? null : paddingOf(...sides);
    if (padding === ctx.node.attrs['padding']) return true;
    dispatch?.(state.tr.setNodeMarkup(ctx.pos, undefined, { ...ctx.node.attrs, padding }));
    return true;
  };
}

/** The gap between the columns of the block the cursor is in, px — null
    where the cursor is in none. */
export function columnsGapOf(state: EditorState): number | null {
  const ctx = findColumnsContext(state);
  if (!ctx) return null;
  return Number(ctx.node.firstChild?.attrs['gutter']) || 0;
}

/** Sets the gap between the columns of the block the cursor is in — on
    every column of it (`gutter`), on the grid and in range. */
export function setColumnsGap(gap: number | string): Command {
  return (state, dispatch) => {
    const ctx = findColumnsContext(state);
    const px = columnSpacingStep(gap, COLUMNS_GAP_MAX);
    if (!ctx || px == null) return false;
    if (dispatch) {
      const tr = state.tr;
      ctx.node.forEach((column, offset) => {
        if (column.attrs['gutter'] !== px) {
          tr.setNodeMarkup(ctx.pos + 1 + offset, undefined, { ...column.attrs, gutter: px });
        }
      });
      if (tr.docChanged) dispatch(tr);
    }
    return true;
  };
}

/** Sets (or clears) the `background` of the `column` the cursor is in. */
export function setColumnBackground(color: string | null): Command {
  return (state, dispatch) => {
    const ctx = findColumnContext(state);
    if (!ctx) return false;
    if (dispatch) {
      const background = color ? toEmailSafeColor(color) : null;
      dispatch(
        state.tr
          .setNodeMarkup(ctx.pos, undefined, { ...ctx.node.attrs, background })
          .scrollIntoView(),
      );
    }
    return true;
  };
}

/**
 * The hybrid's other half, for the email as sent: round every columns
 * block a fixed table the Word engine reads and no one else sees — one
 * cell per column, the column's cap as its width — inside `[if mso]`
 * conditional comments, before, between and after the fluid columns.
 * Outlook lays the columns side by side at their caps (it ignores
 * `inline-block` and `max-width`, and would stack them); every other
 * client drops the comments and keeps the fluid divs. MJML's own way, and
 * the one way to a row in Outlook. A serializer's pass over the rendered
 * DOM (`serializeToHTML`): the comments stand between the columns, where
 * no node's own `emitDOM` can put them; on parse they are dropped, and
 * the block re-emits them, so the round trip holds.
 */
export function outlookColumns(root: HTMLElement): void {
  const prefix = `width: 100%; max-width: ${CONTAINER_MAX}px;`;
  for (const container of Array.from(root.querySelectorAll<HTMLElement>('div'))) {
    if (!(container.getAttribute('style') ?? '').startsWith(prefix)) continue;
    const columns = Array.from(container.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.tagName === 'DIV' &&
        /^display: inline-block;/.test(child.getAttribute('style') ?? ''),
    );
    if (columns.length < 2 || columns.length !== container.children.length) continue;
    const doc = container.ownerDocument;
    // A block with a gap: the Word engine reads no padding on the column's
    // div, but does on its cell — the half-gap goes there too.
    const gutter = (column: HTMLElement) =>
      cardOf(column) && gutterOf(column) ? ` style="padding: ${gutterOf(column) / 2}px;"` : '';
    const cell = (column: HTMLElement) =>
      `<td width="${parseColumnMaxWidth(column.getAttribute('style'))}" ` +
      `valign="${parseColumnVerticalAlign(column)}"${gutter(column)}>`;
    container.insertBefore(
      doc.createComment(
        '[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center">' +
          `<tr>${cell(columns[0])}<![endif]`,
      ),
      columns[0],
    );
    for (let i = 1; i < columns.length; i++) {
      container.insertBefore(
        doc.createComment(`[if mso]></td>${cell(columns[i])}<![endif]`),
        columns[i],
      );
    }
    container.appendChild(doc.createComment('[if mso]></td></tr></table><![endif]'));
  }
}
