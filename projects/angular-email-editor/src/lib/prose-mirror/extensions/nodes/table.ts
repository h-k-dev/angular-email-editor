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
 *  - **No `columnResizing`.** Its whole output is `colwidth` in *pixels*,
 *    which is the responsiveness ledger's central trap. The `colwidth` attr
 *    exists (the library's commands read and write it) but stays null and is
 *    never serialized — inert until a percentage-based resize story is
 *    designed. Nothing hidden survives a round trip.
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
const TABLE_STYLE = 'width: 100%; border-collapse: collapse;';
const CELL_STYLE = 'padding: 8px 12px; vertical-align: top;';

/** A `colspan`/`rowspan` off parsed markup: 1 when absent, malformed, zero or
    negative — real mail carries all of those, and the grid must stay sane. */
function span(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Cell attrs from a `td`/`th`: the spans prosemirror-tables needs, plus our
    fill from an inline `background-color` or the legacy `bgcolor` attribute.
    Anything not colour-safe drops (the schema is law). */
function cellAttrs(dom: HTMLElement): Record<string, unknown> {
  const raw = dom.style?.backgroundColor || dom.getAttribute('bgcolor');
  return {
    colspan: span(dom.getAttribute('colspan')),
    rowspan: span(dom.getAttribute('rowspan')),
    colwidth: null,
    background: isSafeColor(raw) ? raw : null,
  };
}

/** One serialization for the editor and the email alike: spans are email-safe,
    so there is nothing to hide from either side. Attribute order is fixed
    (spans, then style) to keep serialize → parse → serialize a fixpoint. */
function cellDOM(node: { attrs: Record<string, any> }): [string, Record<string, string>, 0] {
  const { colspan, rowspan, background } = node.attrs;
  const attrs: Record<string, string> = {};
  if (colspan > 1) attrs['colspan'] = String(colspan);
  if (rowspan > 1) attrs['rowspan'] = String(rowspan);
  // The fill always carries its paired text colour (FILL_TEXT_COLOR): the cell
  // must not depend on the client's default text, which flips to near-white in
  // non-transforming dark modes while the fill stays pale.
  attrs['style'] = background
    ? `${CELL_STYLE} background-color: ${background}; color: ${FILL_TEXT_COLOR};`
    : CELL_STYLE;
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
      // Pixel column widths — written only by `columnResizing`, which we do
      // not enable (see the node docs). Always null, never serialized.
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
    parseDOM: [{ tag: 'table' }],
    // <tbody> wrapper matches what mail clients expect and what the HTML
    // parser re-injects, so serialize → parse → serialize is a fixpoint.
    toDOM: () => ['table', { style: TABLE_STYLE, role: 'presentation' }, ['tbody', 0]],
  },
  commands: ({ schema }) => ({
    insertTable: (rows = 2, cols = 2): Command => insertTableFocused(schema, rows, cols),
    // Selection-relative structure edits, straight from the library: each one
    // understands merged cells and multi-cell selections for free.
    addRowBefore: (): Command => addRowBefore,
    addRowAfter: (): Command => addRowAfter,
    addColumnBefore: (): Command => addColumnBefore,
    addColumnAfter: (): Command => addColumnAfter,
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
