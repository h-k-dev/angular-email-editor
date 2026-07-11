import {
  Command,
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { Node, NodeType, Schema } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineNode } from '../../extension';

/**
 * Email data tables: a real `<table>` (the most client-compatible layout there
 * is) constrained to a plain rectangular grid — no colspan, no rowspan — so
 * the editing model stays a clean 2D array. This is a *data* table (it stays
 * tabular, the user scrolls on a phone); the future `/columns` block is the
 * spongy layout that stacks. Styles are longhand-only + rgb() so they survive
 * the CSSOM serialize round trip identically across engines (see ROADMAP).
 */
// The serialized table is intentionally borderless — grid lines are an
// editor-only editing aid (see the `.ProseMirror table` rules in the app's
// global styles), not part of the email a recipient receives. Padding is a
// fixed, responsive value (horizontal padding eats a phone's width, so it
// stays modest).
const TABLE_STYLE = 'width: 100%; border-collapse: collapse;';
const CELL_STYLE = 'padding: 8px 12px; vertical-align: top;';

export const TableCell = defineNode({
  name: 'tableCell',
  spec: {
    // Inline content directly in the cell (a textblock), not wrapped
    // paragraphs: an empty cell is `<td></td>`, never `<td><div><br></div></td>`
    // — the stray `<br>` made ProseMirror's parser grow a phantom cell on the
    // round trip. Text marks (bold, links, colour) work in cells for free.
    content: 'inline*',
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
    deleteRow: (): Command => (state, dispatch) => editTable(state, dispatch, deleteRowAt(rowIndexOf(state))),
    deleteColumn: (): Command => (state, dispatch) => editTable(state, dispatch, deleteColumnAt(colIndexOf(state))),
    // Index-addressed variants for the hover controls (a handle targets a
    // specific row/column, independent of where the cursor sits).
    addRowAt: (index: number): Command => (state, dispatch) => editTable(state, dispatch, insertRowAt(index)),
    addColumnAt: (index: number): Command => (state, dispatch) => editTable(state, dispatch, insertColumnAt(index)),
    deleteRowAt: (index: number): Command => (state, dispatch) => editTable(state, dispatch, deleteRowAt(index)),
    deleteColumnAt: (index: number): Command => (state, dispatch) => editTable(state, dispatch, deleteColumnAt(index)),
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
    // Escape the table downward: from the last row, drop a paragraph below
    // (creating one if the table is the last block) so you can always write
    // underneath. Otherwise let the default caret movement handle it.
    ArrowDown: escapeTableDown,
  }),
  // Marks the table the cursor is in so the editor can show a subtle grid
  // *while editing it* — an editing aid only, never serialized.
  plugins: () => [
    new Plugin({
      key: new PluginKey('tableEditingGrid'),
      props: {
        decorations(state) {
          const ctx = findTableContext(state);
          if (!ctx) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(ctx.tablePos, ctx.tablePos + ctx.table.nodeSize, {
              class: 'aee-table-editing',
            }),
          ]);
        },
      },
    }),
  ],
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
    // Map the old cursor through the rebuild, then snap to the nearest valid
    // selection (any kind) so we never create a text selection at a
    // non-inline position.
    const mapped = Math.min(tr.mapping.map(state.selection.from), tr.doc.content.size);
    dispatch(tr.setSelection(Selection.near(tr.doc.resolve(mapped))).scrollIntoView());
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

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const rowIndexOf = (state: EditorState) => findTableContext(state)?.rowIndex ?? 0;
const colIndexOf = (state: EditorState) => findTableContext(state)?.colIndex ?? 0;

function insertRowAt(index: number): TableEdit {
  return (schema, ctx) => {
    const rowType = schema.nodes['tableRow'];
    const cellType = schema.nodes['tableCell'];
    const fresh = rowType.create(
      null,
      Array.from({ length: ctx.cols }, () => cellType.createAndFill()!),
    );
    const rows = tableRows(ctx.table);
    rows.splice(clamp(index, 0, rows.length), 0, fresh);
    return ctx.table.type.create(ctx.table.attrs, rows);
  };
}

function insertColumnAt(index: number): TableEdit {
  return (schema, ctx) => {
    const cellType = schema.nodes['tableCell'];
    const rows = tableRows(ctx.table).map((row) => {
      const cells = rowCells(row);
      cells.splice(clamp(index, 0, cells.length), 0, cellType.createAndFill()!);
      return row.type.create(row.attrs, cells);
    });
    return ctx.table.type.create(ctx.table.attrs, rows);
  };
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

function deleteRowAt(index: number): TableEdit {
  return (_schema, ctx) => {
    if (ctx.rows <= 1 || index < 0 || index >= ctx.rows) return null;
    const rows = tableRows(ctx.table);
    rows.splice(index, 1);
    return ctx.table.type.create(ctx.table.attrs, rows);
  };
}

function deleteColumnAt(index: number): TableEdit {
  return (_schema, ctx) => {
    if (ctx.cols <= 1 || index < 0 || index >= ctx.cols) return null;
    const rows = tableRows(ctx.table).map((row) => {
      const cells = rowCells(row);
      cells.splice(index, 1);
      return row.type.create(row.attrs, cells);
    });
    return ctx.table.type.create(ctx.table.attrs, rows);
  };
}

// Selection-relative wrappers for Tab/keyboard.
const addRow =
  (offset: 0 | 1): TableEdit =>
  (schema, ctx) =>
    insertRowAt(ctx.rowIndex + offset)(schema, ctx);
const addColumn =
  (offset: 0 | 1): TableEdit =>
  (schema, ctx) =>
    insertColumnAt(ctx.colIndex + offset)(schema, ctx);

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
  return pos + 1; // enter the cell (a textblock) to its first inline position
}
