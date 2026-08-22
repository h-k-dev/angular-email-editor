import { Command, EditorState, Plugin, PluginKey, TextSelection, Transaction } from 'prosemirror-state';
import { Node, Schema } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import {
  TableMap,
  TableRect,
  addColumn,
  addColumnAfter,
  addColumnBefore,
  addRow,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  fixTables,
  goToNextCell,
  isInTable,
  mergeCells,
  removeColumn,
  removeRow,
  selectedRect,
  setCellAttr,
  splitCell,
  tableEditing,
} from 'prosemirror-tables';
import { defineNode } from '../../extension';
import { FILL_TEXT_COLOR } from '../../dual-contrast';
import { isSafeColor, toEmailSafeColor } from '../marks/text-style';

/**
 * Email data tables: a real `<table>` (the most client-compatible layout there
 * is), driven by **prosemirror-tables** — the same model Tiptap and friends
 * run on. That library owns the hard parts we were re-deriving by hand: the
 * `TableMap` (grid geometry through merged cells), `CellSelection`
 * (shift-drag a rectangle of cells), and `fixTables` (repair of ragged or
 * overlapping tables). This is a *data* table (it stays tabular, the user
 * scrolls on a phone); `/columns` is the spongy layout that stacks. Styles are
 * longhand-only + rgb() so they survive the CSSOM serialize round trip
 * identically across engines (see ROADMAP).
 *
 * Two deliberate departures from the library's defaults:
 *  - **No pixel column widths.** The library's own `columnResizing` plugin
 *    writes `colwidth` in *pixels* — the responsiveness ledger's central trap
 *    — so it stays off. Our `ColumnResize` extension reuses the same
 *    `colwidth` attr but holds **percentages**, serialized as `width: n%` on
 *    the cells (never a `<colgroup>` — enough clients strip it): fluid at
 *    every viewport, read by fixed layout in every client, identical in the
 *    editor and the email.
 *  - **No header cells.** `<th>` parses (as a plain cell) but never
 *    serializes: an email table is presentational, and a header row that
 *    renders bold in one client and not another is a lie we'd rather not tell.
 *
 * `colspan`/`rowspan`, by contrast, are fully email-safe — Outlook's Word
 * engine handles both — so merged cells are a real feature here, and imported
 * mail keeps its shape instead of being flattened.
 */
// The serialized table is intentionally borderless — grid lines are an
// editor-only editing aid (see the `.ProseMirror table` rules in the app's
// global styles), not part of the email a recipient receives. Padding is a
// fixed, responsive value (horizontal padding eats a phone's width, so it
// stays modest).
// `table-layout: fixed` is the difference between a table you can type in and
// one that jumps: without it, column widths are computed from *content*, so
// every keystroke re-lays out the whole grid and the column you are typing in
// shoves its neighbours sideways. Fixed layout takes the widths from the first
// row instead (equal shares when none are given) and content never moves them.
//
// It is serialized, not editor-only CSS: mail clients default to `auto` too, so
// styling this in the editor alone would make the editor lie about the email —
// stable while composing, jumpy when received. Support is broad (it is CSS2,
// and Word honours it), and with `width: 100%` above it stays fluid.
/** The table's serialized style. Width and offset are attrs (percent; width
    defaults to 100, offset to 0) so the whole table can be resized from
    either edge — the same email-honest unit as the columns: fluid at every
    viewport, and nested percentages compose (a 50% column of an 80% table is
    40% of the container, in every client and in the editor alike). The
    offset serializes as `margin-left` — inline margins on tables are what
    Outlook's own Word composer emits, so its engine reads them, and a client
    that strips them degrades the table gracefully to left-aligned. */
export const tableStyle = (width: number, offset: number): string =>
  `width: ${formatPct(width)};` +
  (offset > 0 ? ` margin-left: ${formatPct(offset)};` : '') +
  ' table-layout: fixed; border-collapse: collapse;';
// Fixed layout means a long unbroken word can no longer widen its column, so it
// would spill out of the cell instead. The editor never showed that (the
// editable root sets `word-wrap` for its own reasons, and it inherits), which
// is exactly why it has to be said out loud here — otherwise the overflow shows
// up only in the recipient's client.
const CELL_STYLE = 'padding: 8px 12px; vertical-align: top; overflow-wrap: break-word;';

/** Canonical percentage: one decimal at most, no trailing zero (25%, 33.3%). */
export const formatPct = (n: number): string => `${Math.round(n * 10) / 10}%`;

/** No column below 10%: at 320px that is ~32px — the width where a column
    stops being a column. The resize drag clamps here, and the add-column
    rescale floors here. */
export const MIN_COLUMN_PCT = 10;

/** No table below 20% of its container — narrower stops being a table. */
export const MIN_TABLE_PCT = 20;

/** A percentage off parsed markup, or null for anything else — pixel values
    are the responsiveness trap and repair away. */
function pctOf(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed.endsWith('%')) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null;
}

/** The table's box off parsed markup — width and left offset, percentages
    only, like the cells. A pixel width (the classic fixed-600px newsletter)
    repairs to full fluid width; the pair clamps so offset + width ≤ 100 and
    the width keeps its floor. */
function parseTableBox(dom: HTMLElement): { width: number; offset: number } {
  const width = Math.min(
    Math.max(pctOf(dom.style?.width || dom.getAttribute('width') || '') ?? 100, MIN_TABLE_PCT),
    100,
  );
  const offset = Math.min(Math.max(pctOf(dom.style?.marginLeft || '') ?? 0, 0), 100 - width);
  return { width, offset };
}

/** A `colspan`/`rowspan` off parsed markup: 1 when absent, malformed, zero or
    negative — real mail carries all of those, and the grid must stay sane. */
function span(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** A declared cell width off parsed markup — **percentages only**. Pixel
    widths (Tiptap's `colwidth`, legacy `width="200"`) are the responsiveness
    trap and drop here; parsing is repair. A span shares its width evenly
    across its columns, matching how fixed layout distributes it. */
function parseCellWidth(dom: HTMLElement, colspan: number): number[] | null {
  const raw = (dom.style?.width || dom.getAttribute('width') || '').trim();
  if (!raw.endsWith('%')) return null;
  const total = Number.parseFloat(raw);
  if (!Number.isFinite(total) || total <= 0 || total >= 100) return null;
  const share = Math.round((total / colspan) * 10) / 10;
  return Array.from({ length: colspan }, () => share);
}

/** Cell attrs from a `td`/`th`: the spans prosemirror-tables needs, a
    percentage width if one is declared, plus our fill from an inline
    `background-color` or the legacy `bgcolor` attribute. Anything not
    colour-safe drops (the schema is law). */
function cellAttrs(dom: HTMLElement): Record<string, unknown> {
  const raw = dom.style?.backgroundColor || dom.getAttribute('bgcolor');
  const colspan = span(dom.getAttribute('colspan'));
  return {
    colspan,
    rowspan: span(dom.getAttribute('rowspan')),
    colwidth: parseCellWidth(dom, colspan),
    background: isSafeColor(raw) ? raw : null,
  };
}

/** One serialization for the editor and the email alike: spans are email-safe,
    so there is nothing to hide from either side. Attribute order is fixed
    (spans, then style) to keep serialize → parse → serialize a fixpoint. */
function cellDOM(node: { attrs: Record<string, any> }): [string, Record<string, string>, 0] {
  const { colspan, rowspan, colwidth, background } = node.attrs;
  const attrs: Record<string, string> = {};
  if (colspan > 1) attrs['colspan'] = String(colspan);
  if (rowspan > 1) attrs['rowspan'] = String(rowspan);
  // Style order is fixed — base, width, fill — to keep the round trip a
  // fixpoint. A span serializes the *sum* of its entries: that is the width
  // the cell actually occupies, and parse splits it back evenly.
  let style = CELL_STYLE;
  const width = Array.isArray(colwidth)
    ? colwidth.reduce((total: number, entry: number | null) => total + (entry ?? 0), 0)
    : 0;
  if (width > 0) style += ` width: ${formatPct(width)};`;
  // The fill always carries its paired text colour (FILL_TEXT_COLOR): the cell
  // must not depend on the client's default text, which flips to near-white in
  // non-transforming dark modes while the fill stays pale.
  if (background) style += ` background-color: ${background}; color: ${FILL_TEXT_COLOR};`;
  attrs['style'] = style;
  return ['td', attrs, 0];
}

export const TableCell = defineNode({
  name: 'tableCell',
  spec: {
    // Inline content directly in the cell (a textblock), not wrapped
    // paragraphs: an empty cell is `<td></td>`, never `<td><div><br></div></td>`
    // — the stray `<br>` made ProseMirror's parser grow a phantom cell on the
    // round trip. Text marks (bold, links, colour) work in cells for free.
    content: 'inline*',
    isolating: true,
    // The role is how prosemirror-tables recognises our nodes as a table;
    // `colspan`/`rowspan`/`colwidth` are the attrs its commands read and write.
    tableRole: 'cell',
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
      // Column widths in **percentages** (one entry per spanned column) —
      // written by the `ColumnResize` extension, serialized as `width: n%`.
      // Same attr name the library's commands expect, different unit on
      // purpose; pixel widths never parse in (see the node docs).
      colwidth: { default: null },
      // A fill colour on the cell (the most bulletproof background in email —
      // `background-color` on `<td>` renders even in Outlook). From the curated
      // dual-safe palette via `setCellBackground`; longhand rgb() keeps it a
      // canonical fixpoint like every other style.
      background: { default: null },
    },
    parseDOM: [
      { tag: 'td', getAttrs: cellAttrs },
      // A header cell parses as an ordinary cell — see the node docs.
      { tag: 'th', getAttrs: cellAttrs },
    ],
    toDOM: cellDOM,
  },
});

export const TableRow = defineNode({
  name: 'tableRow',
  spec: {
    content: 'tableCell+',
    tableRole: 'row',
    parseDOM: [{ tag: 'tr' }],
    toDOM: () => ['tr', 0],
  },
});

export const Table = defineNode({
  name: 'table',
  spec: {
    content: 'tableRow+',
    group: 'block',
    isolating: true,
    tableRole: 'table',
    // Width and left offset in percent of the container; the defaults
    // (100, 0) serialize identically to the pre-attr canonical form.
    attrs: { width: { default: 100 }, offset: { default: 0 } },
    parseDOM: [{ tag: 'table', getAttrs: (dom) => parseTableBox(dom) }],
    // <tbody> wrapper matches what mail clients expect and what the HTML
    // parser re-injects, so serialize → parse → serialize is a fixpoint.
    toDOM: (node) => [
      'table',
      {
        style: tableStyle(node.attrs['width'] as number, node.attrs['offset'] as number),
        role: 'presentation',
      },
      ['tbody', 0],
    ],
  },
  commands: ({ schema }) => ({
    insertTable: (rows = 2, cols = 2): Command => insertTableFocused(schema, rows, cols),
    // Selection-relative structure edits, straight from the library: each one
    // understands merged cells and multi-cell selections for free. The
    // add-column pair is wrapped: on a table with declared widths, the library
    // inserts the new column with none — and under fixed layout an unspecified
    // column gets the *leftover* space, which after a resize is zero. The
    // wrapper rescales the declared widths to free an equal share.
    addRowBefore: (): Command => addRowBefore,
    addRowAfter: (): Command => addRowAfter,
    addColumnBefore: (): Command => withColumnRescale(addColumnBefore),
    addColumnAfter: (): Command => withColumnRescale(addColumnAfter),
    // These refuse when the selection covers every row/column, which is
    // exactly "never delete the last one".
    deleteRow: (): Command => deleteRow,
    deleteColumn: (): Command => deleteColumn,
    deleteTable: (): Command => deleteTable,
    /** Merge the selected rectangle of cells into one (`colspan`/`rowspan`). */
    mergeCells: (): Command => mergeCells,
    /** Split a merged cell back into its grid positions. */
    splitCell: (): Command => splitCell,
    // Index-addressed variants for the hover controls (a handle targets a
    // specific row/column, independent of where the cursor sits).
    addRowAt: (index: number): Command =>
      editTable((tr, rect) => {
        addRow(tr, rect, clamp(index, 0, rect.map.height));
        return true;
      }),
    addColumnAt: (index: number): Command =>
      editTable((tr, rect) => {
        addColumn(tr, rect, clamp(index, 0, rect.map.width));
        rescaleForNewColumn(tr, rect.tableStart - 1);
        return true;
      }),
    deleteRowAt: (index: number): Command =>
      editTable((tr, rect) => {
        if (rect.map.height <= 1 || index < 0 || index >= rect.map.height) return false;
        removeRow(tr, rect, index);
        return true;
      }),
    deleteColumnAt: (index: number): Command =>
      editTable((tr, rect) => {
        if (rect.map.width <= 1 || index < 0 || index >= rect.map.width) return false;
        removeColumn(tr, rect, index);
        return true;
      }),
    /** Fill the cell the cursor is in — or every cell of a cell selection. */
    setCellBackground: (color: string | null): Command => setCellBackground(color),
  }),
  keymap: () => ({
    Tab: tabToCell(1),
    'Shift-Tab': tabToCell(-1),
  }),
  plugins: () => [
    // Ordered on purpose. Extension plugins all run before extension keymaps
    // (see `createEditor`), so an ArrowDown left in this extension's `keymap`
    // would never be reached — `tableEditing` claims the arrows for cell
    // selection first. Registering the escape as a plugin keymap *ahead* of
    // it keeps the pinned behaviour: from the last row, ArrowDown writes
    // below the table rather than stepping between cells.
    keymap({ ArrowDown: escapeTableDown }),
    // Cell selection (shift-click/drag a rectangle), arrow navigation across
    // cells, and Backspace/Delete over a cell selection. Table node selection
    // stays off: a selected table node has no affordance in our UI, and it
    // would swallow keystrokes that should reach the cells.
    tableEditing({ allowTableNodeSelection: false }),
    // Parsing is repair, and this is the table half of it: real mail is full
    // of ragged rows and overlapping spans, which `fixTables` normalizes into
    // a rectangle. Covers everything that reaches the editor as a transaction
    // — paste, drops, `setContent`, an import landing on the html signal —
    // while `repairTables` covers the pure parse path (see `html.ts`).
    new Plugin({
      key: new PluginKey('tableRepair'),
      appendTransaction: (transactions, oldState, newState) =>
        transactions.some((tr) => tr.docChanged) ? fixTables(newState, oldState) : undefined,
    }),
  ],
  // The editor-only grid shown while editing is not the table's own business:
  // `LayoutGuides` marks whichever layout block (table *or* columns) holds the
  // cursor, so both structures reveal themselves identically.
  slashItems: ({ schema }) => [
    {
      title: 'Table',
      keywords: ['table', 'grid', 'rows', 'columns'],
      icon: 'table_chart',
      command: insertTableFocused(schema, 2, 2),
    },
  ],
});

/**
 * Normalizes every table in a freshly parsed document: ragged rows are padded,
 * overlong spans are trimmed. The transaction-driven half lives in the node's
 * repair plugin; this is the pure-function path, so `importedDocument` and
 * `replyDocument` produce the same repaired canonical HTML the editor would.
 * A schema without tables (the HTML source editor) passes straight through.
 */
export function repairTables(doc: Node, schema: Schema): Node {
  if (!schema.nodes['table']) return doc;
  const repair = fixTables(EditorState.create({ doc, schema }));
  return repair ? repair.doc : doc;
}

/** Sets (or clears) the `background` attr of the cell the cursor is in — or of
    every cell in a cell selection, which the library's `setCellAttr` handles.
    Exposed for the app's fill affordance. */
export function setCellBackground(color: string | null): Command {
  return setCellAttr('background', color ? toEmailSafeColor(color) : null);
}

/** Inserts a table and drops the cursor into its first cell. The table is
    located after insertion (rather than by fragile nodeSize math) and
    `cellStart` resolves the exact text position inside cell (0, 0). */
function insertTableFocused(schema: Schema, rows: number, cols: number): Command {
  return (state, dispatch) => {
    const table = buildTable(schema, rows, cols);
    if (!dispatch) return true;

    const from = state.selection.from;
    const tr = state.tr.replaceSelectionWith(table);

    let tablePos = -1;
    tr.doc.descendants((node, pos) => {
      if (tablePos !== -1) return false;
      if (node.type.name === 'table' && pos >= from - 1) tablePos = pos;
      return tablePos === -1;
    });
    if (tablePos >= 0) {
      const inner = cellStart(tr.doc, tablePos, 0, 0);
      if (inner != null) tr.setSelection(TextSelection.create(tr.doc, inner));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

// --- Structure helpers -----------------------------------------------------

interface TableContext {
  table: Node;
  tablePos: number;
  tableDepth: number;
  rowIndex: number;
  colIndex: number;
  cols: number;
  rows: number;
}

/** Locates the table around the selection: the enclosing table node plus the
    current row/column indices. Indices are *grid* coordinates (a merged cell
    reports its top-left corner), because that is what the geometry means once
    spans exist. `null` when the cursor is outside any table. */
export function findTableContext(state: EditorState): TableContext | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'tableCell') continue;
    const tableDepth = depth - 2;
    const table = $from.node(tableDepth);
    const tablePos = $from.before(tableDepth);
    const map = TableMap.get(table);
    const cell = map.findCell($from.before(depth) - (tablePos + 1));
    return {
      table,
      tablePos,
      tableDepth,
      rowIndex: cell.top,
      colIndex: cell.left,
      cols: map.width,
      rows: map.height,
    };
  }
  return null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Runs a structural edit against the table holding the selection. The
    transaction is built even while probing (no dispatch) so enablement is
    reported by the edit itself — cheap, and it can't disagree with what the
    edit would actually do. */
function editTable(edit: (tr: Transaction, rect: TableRect) => boolean): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const tr = state.tr;
    if (!edit(tr, selectedRect(state))) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Wraps a selection-relative add-column command with the width rescale. */
function withColumnRescale(command: Command): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const tablePos = selectedRect(state).tableStart - 1;
    return command(
      state,
      dispatch &&
        ((tr: Transaction) => {
          rescaleForNewColumn(tr, tablePos);
          dispatch(tr);
        }),
    );
  };
}

/**
 * After a column insert: scales every declared width by (n-1)/n, so the new
 * (undeclared) column inherits an equal share of the freed space instead of
 * the leftover — which, on a fully-declared table, is zero, and a zero-width
 * column is a column that looks deleted. Scaled entries floor at
 * {@link MIN_COLUMN_PCT}; tables with no declared widths are untouched.
 */
function rescaleForNewColumn(tr: Transaction, tablePos: number): void {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return;
  const map = TableMap.get(table);
  const factor = (map.width - 1) / map.width;

  const seen = new Set<number>();
  for (const rel of map.map) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const cell = table.nodeAt(rel)!;
    const colwidth = cell.attrs['colwidth'] as (number | null)[] | null;
    if (!colwidth || !colwidth.some((entry) => entry)) continue;
    const scaled = colwidth.map((entry) =>
      // 0 entries are the library's padding for freshly spanned columns —
      // "no width", not "zero width" — and stay untouched.
      entry ? Math.max(Math.round(entry * factor * 10) / 10, MIN_COLUMN_PCT) : entry,
    );
    tr.setNodeMarkup(tablePos + 1 + rel, null, { ...cell.attrs, colwidth: scaled });
  }
}

function buildTable(schema: Schema, rows: number, cols: number): Node {
  const cellType = schema.nodes['tableCell'];
  const rowType = schema.nodes['tableRow'];
  const tableType = schema.nodes['table'];
  const makeRow = () =>
    rowType.create(
      null,
      Array.from({ length: cols }, () => cellType.createAndFill()!),
    );
  return tableType.create(null, Array.from({ length: rows }, makeRow))!;
}

/** ArrowDown from a table's last row: move to the block below, creating an
    empty paragraph when the table is the last node so text can go under it. */
const escapeTableDown: Command = (state, dispatch) => {
  const ctx = findTableContext(state);
  if (!ctx || ctx.rowIndex !== ctx.rows - 1) return false;

  const tableEnd = ctx.tablePos + ctx.table.nodeSize;
  const after = state.doc.resolve(tableEnd).nodeAfter;
  if (after) return false; // a block already follows — let the default move there

  if (dispatch) {
    const paragraph = state.schema.nodes['paragraph'].createAndFill();
    if (!paragraph) return false;
    const tr = state.tr.insert(tableEnd, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, tableEnd + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Tab / Shift-Tab: move to the next / previous cell, adding a row when
    tabbing past the last cell. Tab stays swallowed anywhere inside a table so
    it never escapes into the page's focus order mid-edit. */
function tabToCell(direction: 1 | -1): Command {
  return (state, dispatch) => {
    if (goToNextCell(direction)(state, dispatch)) return true;
    if (!isInTable(state)) return false;
    // Backwards out of the first cell: nothing to move to, but still ours.
    return direction === -1 ? true : appendRowAndEnter(state, dispatch);
  };
}

/** Appends a row to the end of the table and puts the cursor in its first
    cell — Tab's "past the last cell" behaviour. */
const appendRowAndEnter: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (dispatch) {
    const rect = selectedRect(state);
    const tr = state.tr;
    addRow(tr, rect, rect.map.height);
    const table = tr.doc.nodeAt(rect.tableStart - 1);
    if (table) {
      const map = TableMap.get(table);
      const firstCell = rect.tableStart + map.map[(map.height - 1) * map.width];
      tr.setSelection(TextSelection.near(tr.doc.resolve(firstCell + 1)));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** First text position inside the cell at [row, col] of the table at
    `tablePos`, addressed through the grid so merged cells resolve correctly. */
function cellStart(doc: Node, tablePos: number, row: number, col: number): number | null {
  const table = doc.nodeAt(tablePos);
  if (!table) return null;
  const map = TableMap.get(table);
  if (row >= map.height || col >= map.width) return null;
  // Cell positions in the map are relative to the table's content start.
  return tablePos + 1 + map.map[row * map.width + col] + 1;
}
