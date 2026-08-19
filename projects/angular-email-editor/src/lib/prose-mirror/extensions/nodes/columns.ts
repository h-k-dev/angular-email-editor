import { Command, EditorState, Selection, TextSelection } from 'prosemirror-state';
import { Node, Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';
import { FILL_TEXT_COLOR } from '../../dual-contrast';
import { isSafeColor, toEmailSafeColor } from '../marks/text-style';

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
const containerStyle = (align: ColumnsAlignment): string => {
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

// A filled panel always pairs its background with FILL_TEXT_COLOR — explicit
// dark text survives the dark modes that flip default text but keep the fill.
const columnStyle = (maxWidth: number, background: string | null): string =>
  `display: inline-block; width: 100%; max-width: ${maxWidth}px; ` +
  `vertical-align: top; box-sizing: border-box; padding-left: 8px; padding-right: 8px;` +
  (background ? ` background-color: ${background}; color: ${FILL_TEXT_COLOR};` : '');

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

function parseColumnMaxWidth(style: string | null): number {
  const m = /max-width:\s*(\d+)px/.exec(style ?? '');
  return m ? +m[1] : columnMaxWidth(2);
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
    // the block stays a byte-stable fixpoint in both engines.
    attrs: { maxWidth: { default: columnMaxWidth(2) }, background: { default: null } },
    parseDOM: [
      {
        tag: 'div',
        priority: 55,
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const style = el.getAttribute('style') ?? '';
          if (!/display:\s*inline-block/i.test(style)) return false;
          const bg = el.style?.backgroundColor;
          return {
            maxWidth: parseColumnMaxWidth(style),
            background: isSafeColor(bg) ? bg : null,
          };
        },
      },
    ],
    // The class is an editor-only CSS hook for the layout guides; `emitDOM`
    // (serialization) drops it, so the email stays a bare inline-block div.
    toDOM: (node) => [
      'div',
      {
        class: 'aee-column',
        style: columnStyle(node.attrs['maxWidth'], node.attrs['background']),
      },
      0,
    ],
    emitDOM: (node: { attrs: Record<string, any> }) => [
      'div',
      { style: columnStyle(node.attrs['maxWidth'], node.attrs['background']) },
      0,
    ],
  },
});

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
    // Editor-only class (see the Column node) — `emitDOM` keeps the email clean.
    toDOM: (node) => [
      'div',
      { class: 'aee-columns', style: containerStyle(node.attrs['align']) },
      0,
    ],
    emitDOM: (node: { attrs: Record<string, any> }) => [
      'div',
      { style: containerStyle(node.attrs['align']) },
      0,
    ],
  },
  commands: ({ schema }) => ({
    insertColumns: (count = 2): Command => insertColumns(schema, count),
    /** Fill the column the cursor is in (or clear it with `null`). */
    setColumnBackground: (color: string | null): Command => setColumnBackground(color),
    // Structural edits for the block menu. Named apart from the table's
    // `addColumnAfter`/`deleteColumn` — commands merge into one flat record.
    addColumn: (): Command => addColumn,
    removeColumn: (): Command => removeColumn,
    deleteColumns: (): Command => deleteColumns,
  }),
  keymap: () => ({ ArrowDown: escapeColumnsDown }),
  slashItems: ({ schema }) => [
    {
      title: 'Columns',
      keywords: ['columns', 'column', 'layout', 'grid', 'side by side'],
      icon: 'view_column',
      command: insertColumns(schema, 2),
    },
    {
      title: '3 columns',
      keywords: ['columns', 'three', 'layout'],
      icon: 'view_column',
      command: insertColumns(schema, 3),
    },
  ],
});

function hasColumnChildren(dom: HTMLElement): boolean {
  for (const child of Array.from(dom.children)) {
    if (
      child.tagName === 'DIV' &&
      /display:\s*inline-block/i.test(child.getAttribute('style') ?? '')
    ) {
      return true;
    }
  }
  return false;
}

/** Inserts an n-column block and drops the cursor into the first column. */
function insertColumns(schema: Schema, count: number): Command {
  return (state, dispatch) => {
    const colType = schema.nodes['column'];
    const columnsType = schema.nodes['columns'];
    const maxWidth = columnMaxWidth(count);
    const columns = Array.from({ length: count }, () => colType.createAndFill({ maxWidth })!);
    const node = columnsType.create(null, columns);
    if (!dispatch) return true;

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
  const fresh = state.schema.nodes['column'].createAndFill({
    maxWidth: columnMaxWidth(count),
  })!;
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
