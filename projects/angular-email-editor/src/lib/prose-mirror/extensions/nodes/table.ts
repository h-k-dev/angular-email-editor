import {
  Command,
  EditorState,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { Fragment, Node, ResolvedPos, Schema } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { chainCommands } from 'prosemirror-commands';
import {
  CellSelection,
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
  nextCell,
  removeColumn,
  removeRow,
  selectedRect,
  setCellAttr,
  splitCell,
  tableEditing,
} from 'prosemirror-tables';
import { defineNode } from '../../extension';
import { fillTextColor } from '../../dual-contrast';
import { isSafeColor, toEmailSafeColor } from '../marks/text-style';
import { marksAcrossBreak } from '../split-keeping-marks';

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
// No padding here: the email carries only *authored* padding (the `padding`
// attr, parsed off user markup). The comfortable default spacing seen while
// composing is editorial — an `.aee-editor` CSS rule the serializer never
// sees — so it can also reserve the room the block affordances live in.
const cellStyle = (valign: CellVerticalAlignment): string =>
  `vertical-align: ${valign}; overflow-wrap: break-word;`;

/** How a cell's content sits across its width. The same three the rest of the
    editor aligns by (a paragraph's `align`), so one set of buttons drives
    both — and `left` is the default, which canonicalizes to `null` and
    serializes nothing. */
export type CellAlignment = 'center' | 'right' | null;

/** How a cell's content sits down its height. `top` is the default and *is*
    serialized: a cell with no `vertical-align` reads as `middle` in enough
    clients (it is the HTML default) that leaving it out would make the email
    disagree with the editor. */
export type CellVerticalAlignment = 'top' | 'middle' | 'bottom';

/** A cell's horizontal alignment off parsed markup: the inline style first,
    then the legacy `align` attribute — the pair real mail is written with,
    and Outlook's own composer emits both. Anything else (`justify`, an
    inherited `start`) is not a look this schema sells, and repairs to the
    default. */
function parseCellAlign(dom: HTMLElement): CellAlignment {
  const align = (dom.style?.textAlign || dom.getAttribute('align') || '').trim().toLowerCase();
  return align === 'center' || align === 'right' ? align : null;
}

/** The vertical half, the same way: `vertical-align` then the legacy
    `valign`. `baseline` — what a stripped cell reports — is the HTML default
    and means "top" here, which is what every mail client renders it as in a
    single-line cell. */
function parseCellVerticalAlign(dom: HTMLElement): CellVerticalAlignment {
  const align = (dom.style?.verticalAlign || dom.getAttribute('valign') || '').trim().toLowerCase();
  return align === 'middle' || align === 'bottom' ? align : 'top';
}

/**
 * A px-only padding (the shorthand, or any set of longhands) off parsed
 * markup, canonicalized through the CSSOM so serialize → parse → serialize is
 * a fixpoint. Anything else — %, em, negative, calc — repairs away: padding
 * in the email is a deliberate authored choice, in the one unit every client
 * reads the same.
 */
export function parsePadding(dom: HTMLElement): string | null {
  const style = dom.style;
  if (!style) return null;
  let raw = style.padding;
  if (
    !raw &&
    (style.paddingTop || style.paddingRight || style.paddingBottom || style.paddingLeft)
  ) {
    raw =
      `${style.paddingTop || '0px'} ${style.paddingRight || '0px'} ` +
      `${style.paddingBottom || '0px'} ${style.paddingLeft || '0px'}`;
  }
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length > 4) return null;
  if (!parts.every((part) => part === '0' || /^\d+(?:\.\d+)?px$/.test(part))) return null;
  const probe = document.createElement('div');
  probe.style.padding = raw;
  return probe.style.padding || null;
}

/** The bordered table's default grid color: Excel's classic gridline
    blue-gray (#D0D7E5) — the shade a spreadsheet-shaped table is expected to
    wear, light enough to organize without shouting, and legible on both
    white and dark-mode-inverted grounds. Serialized per *cell* (`border` on
    `<td>` is the bulletproof border in email — Outlook's Word engine renders
    it), with `border-collapse` on the table keeping the grid single-lined. */
export const TABLE_BORDER_COLOR = 'rgb(208, 215, 229)';

/** The bordered table's *real* cell padding — Excel-style breathing room, so
    the rendered email is readable inside its grid. Deliberately the same
    value as the editor's editorial default spacing (the app's `.aee-editor
    table td` rule): a bordered and a plain table feel identical while
    composing; only what the recipient gets differs — the preset ships its
    padding, the plain table ships none unless authored. */
export const TABLE_CELL_PADDING = '8px 12px';

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
/** A cell border off parsed markup: the color, when it is colour-safe and a
    border is actually drawn. Width and style normalize to the canonical
    `1px solid` — parsing is repair, and a 3px dashed border is not a look
    this schema sells. */
function parseCellBorder(dom: HTMLElement): string | null {
  const style = dom.style;
  if (!style) return null;
  const color = style.borderTopColor || style.borderColor;
  if (!color || style.borderTopStyle === 'none') return null;
  return isSafeColor(color) ? color : null;
}

function cellAttrs(dom: HTMLElement): Record<string, unknown> {
  const raw = dom.style?.backgroundColor || dom.getAttribute('bgcolor');
  const colspan = span(dom.getAttribute('colspan'));
  return {
    colspan,
    rowspan: span(dom.getAttribute('rowspan')),
    colwidth: parseCellWidth(dom, colspan),
    padding: parsePadding(dom),
    border: parseCellBorder(dom),
    background: isSafeColor(raw) ? raw : null,
    align: parseCellAlign(dom),
    valign: parseCellVerticalAlign(dom),
  };
}

/** One serialization for the editor and the email alike: spans are email-safe,
    so there is nothing to hide from either side. Attribute order is fixed
    (spans, then style) to keep serialize → parse → serialize a fixpoint. */
function cellDOM(node: { attrs: Record<string, any> }): [string, Record<string, string>, 0] {
  const { colspan, rowspan, colwidth, padding, border, background, align, valign } = node.attrs;
  const attrs: Record<string, string> = {};
  if (colspan > 1) attrs['colspan'] = String(colspan);
  if (rowspan > 1) attrs['rowspan'] = String(rowspan);
  // Style order is fixed — padding (authored only), base, alignment, width,
  // border, fill — to keep the round trip a fixpoint. A span serializes the
  // *sum* of its entries: that is the width the cell actually occupies, and
  // parse splits it back evenly.
  let style = (padding ? `padding: ${padding}; ` : '') + cellStyle(valign);
  // Inline `text-align`, not the legacy `align` attribute: the style is what
  // every client reads (the attribute is obsolete HTML that only some still
  // honour), and it is the one declaration a paragraph aligns with too, so a
  // centred cell and a centred line are the same thing in the markup. Left is
  // the default and says nothing.
  if (align) style += ` text-align: ${align};`;
  const width = Array.isArray(colwidth)
    ? colwidth.reduce((total: number, entry: number | null) => total + (entry ?? 0), 0)
    : 0;
  if (width > 0) style += ` width: ${formatPct(width)};`;
  // The real grid line, per cell (the editor's faint editing grid is a class
  // style; this inline border wins over it, so a bordered table shows its
  // actual borders while composing).
  if (border) style += ` border: 1px solid ${border};`;
  // The fill always carries its paired text colour (fillTextColor): the cell
  // must not depend on the client's default text, which flips to near-white in
  // non-transforming dark modes while the fill keeps its colour.
  if (background) style += ` background-color: ${background}; color: ${fillTextColor(background)};`;
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
      // Authored padding only (px, via `parsePadding`); `null` — the default —
      // serializes none, and the editor's comfortable spacing is CSS-only.
      padding: { default: null },
      // The cell's grid-line colour (`border: 1px solid <color>`), or null
      // for the borderless default. Set for every cell of a `/bordered-table`
      // insert; kept uniform by the repair plugin (see `unifyCellBorders`).
      border: { default: null },
      // A fill colour on the cell (the most bulletproof background in email —
      // `background-color` on `<td>` renders even in Outlook). From the curated
      // dual-safe palette via `setCellBackground`; longhand rgb() keeps it a
      // canonical fixpoint like every other style.
      background: { default: null },
      // Where the content sits in the cell. Both are the cell's own business,
      // not a line's: our cells hold inline content directly (there is no
      // paragraph inside to carry an alignment), and a `<td>` is where mail
      // clients expect to read one anyway — `align`/`valign` on the cell is
      // the oldest, most bulletproof layout instruction in email, which is
      // why real messages are full of them. Parsing keeps what they say
      // (`parseCellAlign`, `parseCellVerticalAlign`) instead of flattening
      // every imported table to top-left.
      align: { default: null },
      valign: { default: 'top' },
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
    // Our cells are textblocks (inline content), which makes the gap cursor
    // consider the slot *between two cells* a valid stop — ArrowRight at a
    // cell's end would park a blinking gap there before moving on. Cells are
    // navigated cell to cell (see the arrow keymap); the gap cursor belongs
    // only around the table.
    allowGapCursor: false,
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
    allowGapCursor: false,
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
    /** The default shape is the one /table inserts — three rows by two. */
    insertTable: (rows = 3, cols = 2): Command => insertTableFocused(schema, rows, cols),
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
    /** Whichever of the two applies — one button for both, which is how a
        cell toolbar wants to show it (Tiptap's `mergeOrSplit`). */
    mergeOrSplit: (): Command => chainCommands(mergeCells, splitCell),
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
    /** Align the cell's content across its width — the cell the cursor is in,
        or every cell of a cell selection. The editor's own Align buttons
        reach this without asking for it: `setAlignment` aligns the cell when
        there is no paragraph to align (see email-paragraph.ts). */
    setCellAlignment: (align: CellAlignment): Command => setCellAttr('align', align),
    /** Move the selected row(s) one place up or down — the row grip's menu.
        Refuses where a merged cell crosses the boundary it would pass. */
    moveRow: (offset: number): Command => moveRow(offset),
    /** Move the selected column(s) one place left or right. */
    moveColumn: (offset: number): Command => moveColumn(offset),
    /** Copy the selected row(s) directly below, the column(s) to the right. */
    duplicateRow: (): Command => duplicateRow(),
    duplicateColumn: (): Command => duplicateColumn(),
    /** Align it down the cell's height — top, middle or bottom. */
    setCellVerticalAlign: (valign: CellVerticalAlignment): Command => setCellAttr('valign', valign),
  }),
  keymap: () => ({
    Tab: tabToCell(1),
    'Shift-Tab': tabToCell(-1),
  }),
  plugins: () => [
    // Ordered on purpose. Extension plugins all run before extension keymaps
    // (see `createEditor`), so these bindings can't live in this extension's
    // `keymap` — `tableEditing` would claim the keys first. Registering them
    // as a plugin keymap *ahead* of it keeps two pinned behaviours: from the
    // last row, ArrowDown writes below the table rather than stepping between
    // cells; and Backspace/Delete over a selection covering a *whole*
    // structural unit removes that unit — the full grid removes the table,
    // full rows remove those rows, full columns remove those columns.
    // Anything less falls through to the library's deleteCellSelection,
    // which clears the selected cells' content. Structure deletion is
    // therefore a gesture, not a menu item: select the unit (shift-drag, or
    // shift-arrows growing the cell selection), press Delete.
    //
    // The arrows are ours as well, because the library's own cell navigation
    // is dead for this schema: its `atEndOfCell` starts walking at
    // `$head.depth - 1`, expecting a paragraph *inside* the cell, and our cells
    // hold inline content directly — so it never finds a cell and returns
    // null forever. Left to the browser, arrows crossed cells by accident and
    // Shift-arrows selected cells only when the native selection happened to
    // spill over. Now: an arrow at a cell's edge moves to the neighbouring
    // cell (wrapping rows, leaving the table at its ends); a Shift-arrow at
    // the edge grows a cell selection, the established editor convention and
    // the keyboard route to every cell-selection gesture.
    keymap({
      // A newline in a cell is a hard break: cells are inline-only textblocks
      // (no paragraphs — see the cell node docs), so the stock Enter chain has
      // nothing valid to split. Worse than useless, in fact: on an *empty*
      // in-between cell, `liftEmptyBlock` splits the closest splittable
      // ancestor — the row — and Enter grows the table. Both bindings live
      // here (not on the extensions that own them) because the cell is
      // isolating, which makes the generic handlers refuse it.
      // Yield to a slash / token menu when one is open: these bindings live
      // in `plugins` so they beat `tableEditing`, which also puts them
      // *ahead* of later extension plugins (the menu). A single-line cell
      // is always `endOfTextblock` up and down, so without the yield the
      // table would steal ArrowDown and walk to the next cell. Enter would
      // insert a break instead of applying the highlighted row.
      Enter: yieldToSuggestion(breakInCell),
      'Shift-Enter': breakInCell,
      // Select-all is scoped to the unit being edited: from inside a cell it
      // selects that cell's text, never the whole document. An *empty* cell
      // has no text to scope to, so there it selects every cell — the
      // grid-wide selection whose Delete removes the table. From a cell
      // selection the key falls through to the stock whole-document one.
      'Mod-a': selectCellContent,
      ArrowLeft: cellArrow('horiz', -1),
      ArrowRight: cellArrow('horiz', 1),
      ArrowUp: yieldToSuggestion(cellArrow('vert', -1)),
      ArrowDown: yieldToSuggestion(chainCommands(escapeTableDown, cellArrow('vert', 1))),
      'Shift-ArrowLeft': cellShiftArrow('horiz', -1),
      'Shift-ArrowRight': cellShiftArrow('horiz', 1),
      'Shift-ArrowUp': cellShiftArrow('vert', -1),
      'Shift-ArrowDown': cellShiftArrow('vert', 1),
      Backspace: deleteFullySelected,
      'Mod-Backspace': deleteFullySelected,
      Delete: deleteFullySelected,
      'Mod-Delete': deleteFullySelected,
    }),
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
    // `unifyCellBorders` rides the same pass: cells that structural edits add
    // arrive with the default null border and inherit a uniform table's.
    new Plugin({
      key: new PluginKey('tableRepair'),
      appendTransaction: (transactions, oldState, newState) => {
        if (!transactions.some((tr) => tr.docChanged)) return undefined;
        const tr = fixTables(newState, oldState) ?? newState.tr;
        unifyCellBorders(tr);
        return tr.docChanged ? tr : undefined;
      },
    }),
  ],
  // The editor-only grid shown while editing is not the table's own business:
  // `LayoutGuides` marks whichever layout block (table *or* columns) holds the
  // cursor, so both structures reveal themselves identically.
  // Three rows by two: a table asked for by name starts with somewhere to
  // write a heading line and two entries under it, which is what an email
  // table almost always turns out to be. A picker (the app's grid) says its
  // own size; this is only what `/table` means on its own.
  actions: ({ schema }) => [
    {
      id: 'table',
      title: 'Table',
      keywords: ['table', 'grid', 'rows', 'columns'],
      icon: 'table_chart',
      command: insertTableFocused(schema, 3, 2),
    },
    {
      id: 'bordered-table',
      title: 'Bordered table',
      keywords: ['bordered-table', 'table', 'borders', 'grid', 'excel', 'lines'],
      icon: 'grid_on',
      command: insertTableFocused(schema, 3, 2, TABLE_BORDER_COLOR),
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
function insertTableFocused(
  schema: Schema,
  rows: number,
  cols: number,
  border: string | null = null,
): Command {
  return (state, dispatch) => {
    // Asked, not told: answer before building anything — a toolbar asks on
    // every transaction.
    if (!dispatch) return true;
    const table = buildTable(schema, rows, cols, border);

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

/**
 * Appends a column at the table's end — what the editor's `+` pill on the
 * table's right flank commits (the `ColumnResize` NodeView renders it).
 * Position-addressed rather than selection-relative, because the pill knows
 * which table it belongs to regardless of where the caret is. Runs the same
 * width rescale as every other column add.
 */
export function addColumnAtEnd(tablePos: number): Command {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== 'table') return false;
    if (dispatch) {
      const map = TableMap.get(table);
      const tr = state.tr;
      addColumn(
        tr,
        { map, tableStart: tablePos + 1, table, left: 0, top: 0, right: 0, bottom: 0 },
        map.width,
      );
      rescaleForNewColumn(tr, tablePos);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** The row twin: appends a row at the table's end for the pill under the
    bottom edge. No width math — rows carry none. */
export function addRowAtEnd(tablePos: number): Command {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== 'table') return false;
    if (dispatch) {
      const map = TableMap.get(table);
      const tr = state.tr;
      addRow(
        tr,
        { map, tableStart: tablePos + 1, table, left: 0, top: 0, right: 0, bottom: 0 },
        map.height,
      );
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * Selects a whole row (or column) of the table at `tablePos` — what a grip
 * on the row's flank does when it is pressed.
 *
 * The selection is the handle's whole trick: once the row is a
 * {@link CellSelection}, every command the menu offers is the ordinary
 * selection-relative one — insert, delete, fill, align — and the row lights
 * up while its menu is open, which is the feedback the gesture needs. The
 * library builds the selection out of the two cells at the row's ends, which
 * is also how a shift-drag across the row ends up.
 */
export function selectRow(tablePos: number, index: number): Command {
  return selectBand(tablePos, index, 'row');
}

/** The column twin. */
export function selectColumn(tablePos: number, index: number): Command {
  return selectBand(tablePos, index, 'column');
}

function selectBand(tablePos: number, index: number, kind: 'row' | 'column'): Command {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== 'table') return false;
    const map = TableMap.get(table);
    const last = kind === 'row' ? map.height : map.width;
    if (index < 0 || index >= last) return false;
    const start = tablePos + 1;
    const first = kind === 'row' ? map.map[index * map.width] : map.map[index];
    const end =
      kind === 'row'
        ? map.map[index * map.width + map.width - 1]
        : map.map[(map.height - 1) * map.width + index];
    if (dispatch) {
      const $anchor = state.doc.resolve(start + first);
      const $head = state.doc.resolve(start + end);
      const selection =
        kind === 'row'
          ? CellSelection.rowSelection($anchor, $head)
          : CellSelection.colSelection($anchor, $head);
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }
    return true;
  };
}

/**
 * Moves the selected row one place up or down (`offset` −1 or 1) — the
 * menu's Move row up/down, and the gesture a grip exists for.
 *
 * Rows move as whole nodes: the table's children are reordered and written
 * back in one transaction, so nothing is re-derived and the move is one undo
 * step. A merged cell reaching across either boundary makes the move a lie —
 * the grid would have to be rebuilt around it, and "move" is not a promise
 * to restructure — so the command refuses, and the menu item shows disabled.
 */
export function moveRow(offset: number): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const { map, table, tableStart } = rect;
    const from = rect.top;
    const to = rect.bottom - 1 + offset;
    if (to < 0 || to >= map.height || from + offset < 0) return false;
    // Every boundary the block crosses, and its own two, must be clean.
    for (const row of [rect.top, rect.bottom, offset < 0 ? from + offset : to + 1]) {
      if (!isRowBoundaryClean(map, row)) return false;
    }
    if (dispatch) {
      const rows: Node[] = [];
      table.forEach((row) => rows.push(row));
      const block = rows.splice(rect.top, rect.bottom - rect.top);
      rows.splice(rect.top + offset, 0, ...block);
      const tr = state.tr.replaceWith(tableStart, tableStart + table.content.size, rows);
      // The band travels with its selection: it stays lit where it landed,
      // and the next press on Move moves the same rows again.
      reselectBand(tr, tableStart, 'row', rect.top + offset, rect.bottom - rect.top);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Puts the selection back over a band of rows or columns after its table's
    content has been rewritten — the moved block, at its new index. */
function reselectBand(
  tr: Transaction,
  tableStart: number,
  kind: 'row' | 'column',
  start: number,
  length: number,
): void {
  const table = tr.doc.nodeAt(tableStart - 1);
  if (!table) return;
  const map = TableMap.get(table);
  const end = start + length - 1;
  const first = kind === 'row' ? map.map[start * map.width] : map.map[start];
  const last =
    kind === 'row'
      ? map.map[end * map.width + map.width - 1]
      : map.map[(map.height - 1) * map.width + end];
  const $anchor = tr.doc.resolve(tableStart + first);
  const $head = tr.doc.resolve(tableStart + last);
  tr.setSelection(
    kind === 'row'
      ? CellSelection.rowSelection($anchor, $head)
      : CellSelection.colSelection($anchor, $head),
  );
}

/** Duplicates the selected row (or rows) straight below — the menu's
    Duplicate row. Refused where a merged cell crosses the block's edges, for
    the same reason a move is. */
export function duplicateRow(): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const { map, table, tableStart } = rect;
    if (!isRowBoundaryClean(map, rect.top) || !isRowBoundaryClean(map, rect.bottom)) return false;
    if (dispatch) {
      const rows: Node[] = [];
      table.forEach((row) => rows.push(row));
      const copy = rows.slice(rect.top, rect.bottom).map((row) => row.copy(row.content));
      rows.splice(rect.bottom, 0, ...copy);
      dispatch(
        state.tr.replaceWith(tableStart, tableStart + table.content.size, rows).scrollIntoView(),
      );
    }
    return true;
  };
}

/** The column twins. A column is not a node — it is one cell per row — so
    these rebuild every row with its cells reordered (or copied), which is
    exactly what the browser's own column-less table model forces. The same
    span rule applies: a cell spanning a boundary the column crosses refuses
    the move. */
export function moveColumn(offset: number): Command {
  return columnEdit((cells, rect) => {
    const block = cells.splice(rect.left, rect.right - rect.left);
    cells.splice(rect.left + offset, 0, ...block);
  }, offset);
}

export function duplicateColumn(): Command {
  return columnEdit((cells, rect) => {
    const copy = cells.slice(rect.left, rect.right).map((cell) => cell.copy(cell.content));
    cells.splice(rect.right, 0, ...copy);
  }, 0);
}

function columnEdit(edit: (cells: Node[], rect: TableRect) => void, offset: number): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const { map, table, tableStart } = rect;
    const target = offset < 0 ? rect.left + offset : rect.right - 1 + offset;
    if (target < 0 || target >= map.width) return false;
    // Cleanliness is per column boundary, checked across every row — and a
    // row whose cells do not simply line up one per column (a rowspan from
    // above) has no cell of its own to move.
    for (const col of [rect.left, rect.right, offset < 0 ? rect.left + offset : target + 1]) {
      if (!isColumnBoundaryClean(map, col)) return false;
    }
    for (let row = 0; row < map.height; row++) {
      if (table.child(row).childCount !== map.width) return false;
    }
    if (dispatch) {
      const rows: Node[] = [];
      table.forEach((row) => {
        const cells: Node[] = [];
        row.forEach((cell) => cells.push(cell));
        edit(cells, rect);
        rows.push(row.copy(Fragment.fromArray(cells)));
      });
      const tr = state.tr.replaceWith(tableStart, tableStart + table.content.size, rows);
      reselectBand(tr, tableStart, 'column', rect.left + offset, rect.right - rect.left);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Whether the horizontal line above row `index` cuts no merged cell — the
    table's own top and bottom edges always do. */
function isRowBoundaryClean(map: TableMap, index: number): boolean {
  if (index <= 0 || index >= map.height) return true;
  for (let col = 0; col < map.width; col++) {
    if (map.map[(index - 1) * map.width + col] === map.map[index * map.width + col]) return false;
  }
  return true;
}

/** The vertical twin. */
function isColumnBoundaryClean(map: TableMap, index: number): boolean {
  if (index <= 0 || index >= map.width) return true;
  for (let row = 0; row < map.height; row++) {
    if (map.map[row * map.width + index - 1] === map.map[row * map.width + index]) return false;
  }
  return true;
}

function buildTable(schema: Schema, rows: number, cols: number, border: string | null): Node {
  const cellType = schema.nodes['tableCell'];
  const rowType = schema.nodes['tableRow'];
  const tableType = schema.nodes['table'];
  // The bordered preset ships real padding with its grid (see
  // TABLE_CELL_PADDING); a plain table ships none unless authored.
  const attrs = { border, padding: border ? TABLE_CELL_PADDING : null };
  const makeRow = () =>
    rowType.create(
      null,
      Array.from({ length: cols }, () => cellType.createAndFill(attrs)!),
    );
  return tableType.create(null, Array.from({ length: rows }, makeRow))!;
}

/**
 * Keeps a *uniformly* bordered table uniform: when every bordered cell wears
 * the same colour and some cells have none — which is what any structural
 * edit produces, since `addRow`/`addColumn`/the pills create cells with the
 * default null border — the bare cells inherit it. A table with *mixed*
 * border colours (authored, imported) is left exactly as written: repair,
 * not opinion. `setNodeMarkup` never changes node sizes, so positions
 * collected up front stay valid as the jobs apply.
 */
function unifyCellBorders(tr: Transaction): void {
  const jobs: { pos: number; attrs: Record<string, unknown> }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;

    const colors = new Set<string>();
    let bare = 0;
    node.descendants((cell) => {
      if (cell.type.name !== 'tableCell') return true;
      const border = cell.attrs['border'] as string | null;
      if (border) colors.add(border);
      else bare++;
      return true;
    });

    if (colors.size === 1 && bare > 0) {
      const border = [...colors][0];
      node.descendants((cell, rel) => {
        if (cell.type.name === 'tableCell' && !cell.attrs['border']) {
          jobs.push({ pos: pos + 1 + rel, attrs: { ...cell.attrs, border } });
        }
        return true;
      });
    }
    return false; // cells handled; nothing tabular nests deeper
  });
  for (const job of jobs) tr.setNodeMarkup(job.pos, null, job.attrs);
}

/** Backspace/Delete with a whole structural unit selected: the user marked
    it — deleting "all the content" of a table, row or column *is* deleting
    the unit, and leaving an empty husk behind would be the one thing that
    selection did not ask for. Full grid → the table; full-width rows → those
    rows; full-height columns → those columns. Any lesser selection returns
    false and falls through to `deleteCellSelection` (clear contents), the
    library default. */
export const deleteFullySelected: Command = (state, dispatch) => {
  const selection = state.selection;
  if (!(selection instanceof CellSelection)) return false;
  const table = selection.$anchorCell.node(-1);
  const tableStart = selection.$anchorCell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart,
  );
  const fullWidth = rect.left === 0 && rect.right === map.width;
  const fullHeight = rect.top === 0 && rect.bottom === map.height;
  if (fullWidth && fullHeight) return deleteTable(state, dispatch);
  if (fullWidth) return deleteRow(state, dispatch);
  if (fullHeight) return deleteColumn(state, dispatch);
  return false;
};

/** A suggestion menu (slash, tokens, …) is open at the caret — its plugin
    state carries a `session`. Those keys are the menu's, not the table's. */
function suggestionMenuIsOpen(state: EditorState): boolean {
  for (const plugin of state.plugins) {
    const value = plugin.getState(state) as { session?: unknown } | undefined;
    if (value?.session) return true;
  }
  return false;
}

/** Runs `command` only when no suggestion menu is claiming the key. */
function yieldToSuggestion(command: Command): Command {
  return (state, dispatch, view) =>
    suggestionMenuIsOpen(state) ? false : command(state, dispatch, view);
}

type Axis = 'horiz' | 'vert';

const edgeName = (axis: Axis, dir: 1 | -1) =>
  axis === 'vert' ? (dir > 0 ? 'down' : 'up') : dir > 0 ? 'right' : 'left';

/** The caret's cell, resolved at the cell's own position, when the caret
    stands at that cell's edge in `dir` (so the arrow has nowhere to go within
    the cell). Vertical moves require an empty selection, like the library. */
function caretCellAtEdge(
  state: EditorState,
  view: EditorView,
  axis: Axis,
  dir: 1 | -1,
): ResolvedPos | null {
  const selection = state.selection;
  if (!(selection instanceof TextSelection)) return null;
  if (axis === 'vert' && !selection.empty) return null;
  const { $head } = selection;
  if ($head.parent.type.spec['tableRole'] !== 'cell') return null;
  if (!view.endOfTextblock(edgeName(axis, dir))) return null;
  return state.doc.resolve($head.before());
}

/** Arrow keys across cells: from a cell's edge, the caret moves into the
    neighbouring cell (rows wrap horizontally; the table's outer edges hand
    off to the surrounding blocks). A cell selection collapses to a caret at
    its head cell. Anywhere inside a cell's text, the browser keeps the key. */
function cellArrow(axis: Axis, dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const selection = state.selection;
    if (selection instanceof CellSelection) {
      dispatch?.(state.tr.setSelection(Selection.near(selection.$headCell, dir)).scrollIntoView());
      return true;
    }
    const $cell = caretCellAtEdge(state, view, axis, dir);
    if (!$cell) return false;

    let target: Selection | null;
    if (axis === 'horiz') {
      const from = dir > 0 ? $cell.pos + $cell.nodeAfter!.nodeSize : $cell.pos;
      target = Selection.findFrom(state.doc.resolve(from), dir, true);
    } else {
      const $next = nextCell($cell, axis, dir);
      target = $next
        ? Selection.near($next, 1)
        : Selection.findFrom(
            state.doc.resolve(dir > 0 ? $cell.after(-1) : $cell.before(-1)),
            dir,
            true,
          );
    }
    if (!target) return false;
    dispatch?.(state.tr.setSelection(target).scrollIntoView());
    return true;
  };
}

/** Shift-arrows grow a cell selection: from a caret at a cell's edge, this
    cell plus the neighbour; from a cell selection, one more cell at the head.
    At the table's outer edge a cell selection stays put rather than spilling
    into the surrounding text. */
function cellShiftArrow(axis: Axis, dir: 1 | -1): Command {
  return (state, dispatch, view) => {
    if (!view) return false;
    const selection = state.selection;
    let $anchor: ResolvedPos;
    let $head: ResolvedPos;
    if (selection instanceof CellSelection) {
      $anchor = selection.$anchorCell;
      $head = selection.$headCell;
    } else {
      const $cell = caretCellAtEdge(state, view, axis, dir);
      if (!$cell) return false;
      $anchor = $head = $cell;
    }
    const $next = nextCell($head, axis, dir);
    if (!$next) return selection instanceof CellSelection;
    dispatch?.(state.tr.setSelection(new CellSelection($anchor, $next)).scrollIntoView());
    return true;
  };
}

/** Enter / Shift-Enter inside a cell: a hard break, carrying the marks that
    survive a break — the same continuation rule as everywhere else (see
    {@link marksAcrossBreak}). A cell selection is not a place to type a
    newline, so it falls through. */
const breakInCell: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (state.selection instanceof CellSelection) return false;
  if ($from.parent.type.spec['tableRole'] !== 'cell' || !$from.sameParent($to)) return false;

  if (dispatch) {
    const marks = marksAcrossBreak(state);
    const tr = state.tr.replaceSelectionWith(state.schema.nodes['hardBreak'].create());
    if (marks) tr.ensureMarks(marks);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Mod-A with the caret in a cell: select that cell's content — or, from an
    empty cell, every cell — and stop; see the keymap note. A cell selection
    is already beyond single-cell editing and falls through to the stock
    select-all. */
const selectCellContent: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (state.selection instanceof CellSelection) return false;
  if ($from.parent.type.spec['tableRole'] !== 'cell') return false;

  if (dispatch) {
    if ($from.parent.content.size === 0) {
      const map = TableMap.get($from.node(-2));
      const tableStart = $from.start(-2);
      const $first = state.doc.resolve(tableStart + map.map[0]);
      const $last = state.doc.resolve(tableStart + map.map[map.map.length - 1]);
      dispatch(state.tr.setSelection(new CellSelection($first, $last)));
    } else {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())));
    }
  }
  return true;
};

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
