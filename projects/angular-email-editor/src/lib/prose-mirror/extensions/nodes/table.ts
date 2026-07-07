import { Command, EditorState, TextSelection, Transaction } from 'prosemirror-state';
import { Node, NodeType, Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';

/**
 * Email data tables: a real `<table>` (the most client-compatible layout there
 * is) constrained to a plain rectangular grid — no colspan, no rowspan — so
 * the editing model stays a clean 2D array. This is a *data* table (it stays
 * tabular, the user scrolls on a phone); the future `/columns` block is the
 * spongy layout that stacks. Styles are longhand-only + rgb() so they survive
 * the CSSOM serialize round trip identically across engines (see ROADMAP).
 */
// Borderless by necessity, not taste: Chrome canonicalizes `border` to
// longhands while jsdom collapses longhands to the shorthand, so no border
// declaration serializes identically across engines. `border-collapse`
// removes default cell spacing; padding + vertical-align are the only cell
// styling, and both survive the round trip byte-for-byte everywhere. Visual
// row separation (background striping) is a deterministic follow-up.
const TABLE_STYLE = 'width: 100%; border-collapse: collapse;';
const CELL_STYLE = 'padding: 8px 12px; vertical-align: top;';

export const TableCell = defineNode({
  name: 'tableCell',
  spec: {
    content: 'paragraph+',
    isolating: true,
    parseDOM: [{ tag: 'td' }, { tag: 'th' }],
    toDOM: () => ['td', { style: CELL_STYLE }, 0],
  },
});

export const TableRow = defineNode({
  name: 'tableRow',
  spec: {
    content: 'tableCell+',
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
    parseDOM: [{ tag: 'table' }],
    // <tbody> wrapper matches what mail clients expect and what the HTML
    // parser re-injects, so serialize → parse → serialize is a fixpoint.
    toDOM: () => ['table', { style: TABLE_STYLE, role: 'presentation' }, ['tbody', 0]],
  },
  commands: ({ schema }) => ({
    insertTable:
      (rows = 2, cols = 2): Command =>
      insertTableFocused(schema, rows, cols),
    addRowAfter: (): Command => (state, dispatch) => editTable(state, dispatch, addRow(1)),
    addRowBefore: (): Command => (state, dispatch) => editTable(state, dispatch, addRow(0)),
    addColumnAfter: (): Command => (state, dispatch) => editTable(state, dispatch, addColumn(1)),
    addColumnBefore: (): Command => (state, dispatch) => editTable(state, dispatch, addColumn(0)),
    deleteRow: (): Command => (state, dispatch) => editTable(state, dispatch, deleteRow),
    deleteColumn: (): Command => (state, dispatch) => editTable(state, dispatch, deleteColumn),
    deleteTable: (): Command => (state, dispatch) => {
      const ctx = findTableContext(state);
      if (!ctx) return false;
      dispatch?.(state.tr.delete(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize).scrollIntoView());
      return true;
    },
  }),
  keymap: () => ({
    Tab: goToCell(1),
    'Shift-Tab': goToCell(-1),
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Table',
      keywords: ['table', 'grid', 'rows', 'columns'],
      icon: 'table_chart',
      command: insertTableFocused(schema, 2, 2),
    },
  ],
});

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
      const inner = cellStart(tr.doc, tablePos, 0, 0, schema.nodes['tableCell']);
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
    current row/column indices. `null` when the cursor is outside any table. */
export function findTableContext(state: EditorState): TableContext | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'tableCell') continue;
    const tableDepth = depth - 2;
    const table = $from.node(tableDepth);
    return {
      table,
      tablePos: $from.before(tableDepth),
      tableDepth,
      rowIndex: $from.index(tableDepth),
      colIndex: $from.index(depth - 1),
      cols: table.firstChild ? table.firstChild.childCount : 0,
      rows: table.childCount,
    };
  }
  return null;
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

type TableEdit = (schema: Schema, ctx: TableContext) => Node | null;

/** Runs a structural edit by rebuilding the whole table node and replacing it
    — small tables make this simpler and safer than in-place position math. */
function editTable(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  edit: TableEdit,
): boolean {
  const ctx = findTableContext(state);
  if (!ctx) return false;
  const next = edit(state.schema, ctx);
  if (!next) return false;

  if (dispatch) {
    const tr = state.tr.replaceWith(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize, next);
    const selection = TextSelection.near(tr.doc.resolve(Math.min(state.selection.from, tr.doc.content.size)));
    dispatch(tr.setSelection(selection).scrollIntoView());
  }
  return true;
}

const rowCells = (row: Node): Node[] => {
  const cells: Node[] = [];
  row.forEach((cell) => cells.push(cell));
  return cells;
};

const tableRows = (table: Node): Node[] => {
  const rows: Node[] = [];
  table.forEach((row) => rows.push(row));
  return rows;
};

function addRow(offset: 0 | 1): TableEdit {
  return (schema, ctx) => {
    const rowType = schema.nodes['tableRow'];
    const cellType = schema.nodes['tableCell'];
    const fresh = rowType.create(
      null,
      Array.from({ length: ctx.cols }, () => cellType.createAndFill()!),
    );
    const rows = tableRows(ctx.table);
    rows.splice(ctx.rowIndex + offset, 0, fresh);
    return ctx.table.type.create(ctx.table.attrs, rows);
  };
}

function addColumn(offset: 0 | 1): TableEdit {
  return (schema, ctx) => {
    const cellType = schema.nodes['tableCell'];
    const rows = tableRows(ctx.table).map((row) => {
      const cells = rowCells(row);
      cells.splice(ctx.colIndex + offset, 0, cellType.createAndFill()!);
      return row.type.create(row.attrs, cells);
    });
    return ctx.table.type.create(ctx.table.attrs, rows);
  };
}

const deleteRow: TableEdit = (_schema, ctx) => {
  if (ctx.rows <= 1) return null;
  const rows = tableRows(ctx.table);
  rows.splice(ctx.rowIndex, 1);
  return ctx.table.type.create(ctx.table.attrs, rows);
};

const deleteColumn: TableEdit = (_schema, ctx) => {
  if (ctx.cols <= 1) return null;
  const rows = tableRows(ctx.table).map((row) => {
    const cells = rowCells(row);
    cells.splice(ctx.colIndex, 1);
    return row.type.create(row.attrs, cells);
  });
  return ctx.table.type.create(ctx.table.attrs, rows);
};

/** Tab / Shift-Tab: move to the next / previous cell, adding a row when
    tabbing past the last cell. */
function goToCell(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const ctx = findTableContext(state);
    if (!ctx) return false;
    if (!dispatch) return true;

    const cellType = state.schema.nodes['tableCell'] as NodeType;
    const flatIndex = ctx.rowIndex * ctx.cols + ctx.colIndex;
    const cellCount = ctx.rows * ctx.cols;
    const target = flatIndex + direction;

    if (target >= cellCount) {
      // Past the last cell: append a row and land in its first cell.
      editTable(state, dispatch, addRow(1));
      return true;
    }
    if (target < 0) return true;

    const targetRow = Math.floor(target / ctx.cols);
    const targetCol = target % ctx.cols;
    const pos = cellStart(state.doc, ctx.tablePos, targetRow, targetCol, cellType);
    if (pos != null) dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
    return true;
  };
}

/** First text position inside the cell at [row, col] of the table at
    `tablePos`. */
function cellStart(
  doc: Node,
  tablePos: number,
  row: number,
  col: number,
  _cellType: NodeType,
): number | null {
  const table = doc.nodeAt(tablePos);
  if (!table) return null;
  const rowNode = table.child(row);
  // tablePos + 1 enters the table; walk rows, then cells, to the target.
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1; // enter the row
  for (let c = 0; c < col; c++) pos += rowNode.child(c).nodeSize;
  return pos + 2; // enter the cell, then its first paragraph
}
