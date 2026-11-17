import { Fragment, Node, ResolvedPos, Schema } from 'prosemirror-model';
import { Command } from 'prosemirror-state';
import { stackingClasses } from './authored-page';
import { DocumentEnvelope } from './envelope';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { SECTION_CONTENT_MAX, SectionWidth } from './extensions/nodes/section';
import { CellVerticalAlignment, parsePadding } from './extensions/nodes/table';
import { parseHTML, serializeToHTML } from './html';
import { paddingSides, parseDeclarations } from './inline-style';

/**
 * Columns written by hand, recognised — never repaired. The way a hand
 * codes a row that stacks on a phone: a 100% presentation table of one row,
 * two cells or more, every cell of a class the head's `@media` rule turns
 * into a block (`.stack { display: block; width: 100% }`). Side by side on
 * a desktop, one under another on a phone — which is what a columns block
 * of ours is, without the head's rule (columns.ts). The parse keeps the
 * table as written; this says what it would be in our blocks, for the host
 * to suggest:
 *
 * - each cell — a column: its padding and fill the column's, its vertical
 *   alignment, capped at the width it says (plus its side padding: a cell's
 *   width is its content's) or, saying none, an equal share of what is
 *   left of the row; its words in a block carrying the text styles the cell
 *   gave them, its blocks as they stood;
 * - a line the table draws above or below itself (`border-top`,
 *   `border-bottom`) — a rule of that colour and height, above or below
 *   the columns.
 *
 * Only what a columns block can say is offered: a cell of a class of the
 * author's own, a table with corners or a fill, anything else it cannot
 * carry keeps its markup. And only where the row it stands in says its
 * width — a row of a page of rows, or a section — since a column's cap is
 * px. The author decides ({@link convertAuthoredStackRow}); nothing here
 * runs on its own. Read off the attributes' text, never the CSSOM.
 */
export interface AuthoredStackRow {
  /** Its columns, in order. */
  columns: AuthoredStackColumn[];
  /** The lines it draws above and below itself. */
  top: AuthoredLine | null;
  bottom: AuthoredLine | null;
}

export interface AuthoredStackColumn {
  /** The width the cell says for its content: px, a percent of the row, or
      null for a share of what the others leave. */
  width: { px: number } | { percent: number } | null;
  valign: CellVerticalAlignment;
  /** Its padding, as `parsePadding` normalises it, or null. */
  padding: string | null;
  /** Its fill, email-safe hex, or null. */
  background: string | null;
  /** The text styles its words take from it, as written — `name: value`. */
  text: string[];
  /** What it holds, as HTML. */
  html: string;
  /** Whether words stand straight in it, beside or without blocks. */
  bare: boolean;
}

export interface AuthoredLine {
  /** Its height, px. */
  height: number;
  /** Its colour, as written. */
  color: string;
}

/** Recognised tables, by node — and the head they were read against. */
const seen = new WeakMap<Node, { head: string; result: AuthoredStackRow | null }>();

/** What the table at hand would be in our blocks, if it is a row of
    columns written by hand — null for anything else. `doc` lends its head:
    the cells' class stacks only where a rule of the head's says so. */
export function authoredStackRow(node: Node, schema: Schema, doc: Node): AuthoredStackRow | null {
  if (node.type.name !== 'htmlElement' || node.attrs['tag'] !== 'table') return null;
  const head = (doc.attrs['envelope'] as DocumentEnvelope | null | undefined)?.head ?? '';
  if (!head) return null;
  const known = seen.get(node);
  if (known && known.head === head) return known.result;
  const result = recognise(node, schema, head);
  seen.set(node, { head, result });
  return result;
}

/** Every row of columns written by hand that an author could convert —
    recognised, and standing where its width is known — by position, in
    document order. */
export function authoredStackRowPositions(doc: Node): number[] {
  const schema = doc.type.schema;
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock || node.isAtom) return false;
    const row = authoredStackRow(node, schema, doc);
    if (!row) return true;
    if (columnsBlock(row, rowWidthAt(doc, doc.resolve(pos)), schema)) found.push(pos);
    return false;
  });
  return found;
}

/** Turns the row of columns written by hand at `pos` into the columns
    block it stands for ({@link authoredStackRow}), a rule above or below
    it where the table drew a line there — one step, undone as one. False
    where the node is not such a row, or stands where its width is not
    known. */
export function convertAuthoredStackRow(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const row = node ? authoredStackRow(node, state.schema, state.doc) : null;
    if (!node || !row) return false;
    const $pos = state.doc.resolve(pos);
    const block = columnsBlock(row, rowWidthAt(state.doc, $pos), state.schema);
    if (!block) return false;
    const blocks = [
      ...(row.top ? [ruleOf(row.top, state.schema)] : []),
      block,
      ...(row.bottom ? [ruleOf(row.bottom, state.schema)] : []),
    ].filter((made): made is Node => !!made);
    const index = $pos.index();
    if (!$pos.parent.canReplace(index, index + 1, Fragment.fromArray(blocks))) return false;
    dispatch?.(state.tr.replaceWith(pos, pos + node.nodeSize, blocks).scrollIntoView());
    return true;
  };
}

/** The row a block at `$pos` stands in, px — a row of a page of rows (the
    page's width less the row's side padding) or a section (its content's
    width) — or null where nothing says it. */
function rowWidthAt(doc: Node, $pos: ResolvedPos): number | null {
  const parent = $pos.parent;
  if (parent.type.name === 'pageRow') {
    const layout = doc.attrs['pageLayout'] as { width?: number; rowPadding?: number } | null;
    if (!layout?.width) return null;
    const own = parent.attrs['padding'] as string | null;
    const [, right, , left] = paddingSides(own ?? `${layout.rowPadding ?? 0}px`).map(
      (side) => parseFloat(side) || 0,
    );
    return layout.width - left - right;
  }
  if (parent.type.name === 'section') {
    const width = parent.attrs['width'] as SectionWidth;
    return (typeof width === 'number' ? width : SECTION_CONTENT_MAX) - 2 * parent.attrs['inset'];
  }
  return null;
}

/** Our columns block for a recognised row, each column capped for a `row`
    px wide — null where the row's width is not known, the cells' own widths
    leave the others nothing, or a cell's content is no column's. */
function columnsBlock(row: AuthoredStackRow, width: number | null, schema: Schema): Node | null {
  if (width === null || width <= 0) return null;
  // A cell's width is its content's: its side padding stands beside it.
  const fixed = row.columns.map((column) => {
    if (!column.width) return null;
    if ('percent' in column.width) return (width * column.width.percent) / 100;
    const [, right, , left] = paddingSides(column.padding ?? '0px').map(
      (side) => parseFloat(side) || 0,
    );
    return column.width.px + left + right;
  });
  const said = fixed.reduce<number>((sum, cap) => sum + (cap ?? 0), 0);
  const shared = fixed.filter((cap) => cap === null).length;
  const share = shared ? (width - said) / shared : 0;
  if (said > width + 0.5 || (shared && share < 1)) return null;
  try {
    const columns = row.columns.map((column, index) => {
      const holder = document.createElement('div');
      holder.innerHTML = column.html;
      let html = column.html;
      if (column.text.length || column.bare) {
        if (column.text.length) holder.setAttribute('style', column.text.join('; ') + ';');
        html = holder.outerHTML;
      }
      return schema.nodes['column'].createChecked(
        {
          // Down, never up: the caps never outgrow the row.
          maxWidth: Math.max(1, Math.floor((fixed[index] ?? share) + 1e-6)),
          valign: column.valign,
          padding: column.padding,
          background: column.background,
        },
        parseHTML(html, schema).content,
      );
    });
    return schema.nodes['columns'].createChecked(null, columns);
  } catch {
    return null;
  }
}

/** A line the table drew, as a rule of ours carrying it as written: its
    height and colour, no room of its own. */
function ruleOf(line: AuthoredLine, schema: Schema): Node | null {
  const rule = document.createElement('hr');
  rule.setAttribute(
    'style',
    `height: ${line.height}px; width: 100%; background-color: ${line.color}; ` +
      'margin-top: 0px; margin-bottom: 0px; border: 0;',
  );
  return parseHTML(rule.outerHTML, schema).content.firstChild;
}

/** What a hand's table may say for a columns block to draw it the same. */
const TABLE_ATTRIBUTES = new Set([
  'role',
  'width',
  'cellpadding',
  'cellspacing',
  'border',
  'style',
]);
const CELL_ATTRIBUTES = new Set(['class', 'width', 'valign', 'style']);

/** The text styles a cell's words take from it. */
const TEXT_STYLES = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'text-transform',
  'white-space',
]);

const PX = /^(\d+(?:\.\d+)?)(?:px)?$/i;
const PERCENT = /^(\d+(?:\.\d+)?)%$/;
/** A line: `1px solid #e9e9e9`. */
const LINE = /^(\d+(?:\.\d+)?)px\s+solid\s+(\S.*)$/i;

function recognise(node: Node, schema: Schema, head: string): AuthoredStackRow | null {
  const stacking = stackingClasses(head);
  if (!stacking.size) return null;
  const html = serializeToHTML(schema.topNodeType.create(null, node), schema);
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const table = body.children.length === 1 ? body.children[0] : null;
  if (!(table instanceof HTMLTableElement)) return null;
  if (Array.from(table.attributes).some(({ name }) => !TABLE_ATTRIBUTES.has(name))) return null;
  for (const name of ['cellpadding', 'cellspacing', 'border']) {
    const value = table.getAttribute(name);
    if (value !== null && value !== '0') return null;
  }
  const style = declared(table);
  if ((table.getAttribute('width') ?? style.get('width')) !== '100%') return null;
  let top: AuthoredLine | null = null;
  let bottom: AuthoredLine | null = null;
  for (const [name, value] of style) {
    if (name === 'width' || name === 'border-collapse') continue;
    const line = name === 'border-top' || name === 'border-bottom' ? lineOf(value) : null;
    if (!line) return null;
    if (name === 'border-top') top = line;
    else bottom = line;
  }
  if (table.rows.length !== 1 || table.rows[0].attributes.length) return null;
  const cells = Array.from(table.rows[0].cells);
  if (cells.length < 2 || cells.some((cell) => cell.tagName !== 'TD')) return null;
  const columns: AuthoredStackColumn[] = [];
  for (const cell of cells) {
    const column = columnOf(cell, stacking);
    if (!column) return null;
    columns.push(column);
  }
  return { columns, top, bottom };
}

/** A cell as a column — null where it says what a column cannot. */
function columnOf(cell: HTMLTableCellElement, stacking: Set<string>): AuthoredStackColumn | null {
  if (Array.from(cell.attributes).some(({ name }) => !CELL_ATTRIBUTES.has(name))) return null;
  if (cell.colSpan !== 1 || cell.rowSpan !== 1) return null;
  const classes = (cell.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  // The class that stacks it, and no other: a class of the author's own is
  // drawn by their head.
  if (!classes.length || classes.some((name) => !stacking.has(name))) return null;
  const style = declared(cell);
  const text: string[] = [];
  let background: string | null = null;
  for (const [name, value] of style) {
    if (/^padding(?:-|$)/.test(name) || name === 'vertical-align' || name === 'width') continue;
    if (name === 'background-color' && isSafeColor(value)) background = toEmailSafeColor(value);
    else if (TEXT_STYLES.has(name)) text.push(`${name}: ${value}`);
    else return null;
  }
  const width = widthOf(cell.getAttribute('width') ?? style.get('width'));
  if (width === false) return null;
  // A cell with no alignment of its own sits in the middle, as tables do.
  const valign = (cell.getAttribute('valign') ?? style.get('vertical-align') ?? 'middle')
    .trim()
    .toLowerCase();
  if (valign !== 'top' && valign !== 'middle' && valign !== 'bottom') return null;
  const bare = Array.from(cell.childNodes).some(
    (child) => child.nodeType === 3 && !!child.textContent?.trim(),
  );
  if (!bare && !cell.children.length) return null;
  return {
    width,
    valign,
    padding: parsePadding(cell),
    background,
    text,
    html: cell.innerHTML,
    bare,
  };
}

/** A width a cell says — px, percent, none (null) — or false for one that
    is neither. */
function widthOf(value: string | null | undefined): AuthoredStackColumn['width'] | false {
  const said = (value ?? '').trim();
  if (!said) return null;
  const px = PX.exec(said);
  if (px) return { px: Number(px[1]) };
  const percent = PERCENT.exec(said);
  return percent ? { percent: Number(percent[1]) } : false;
}

function lineOf(value: string): AuthoredLine | null {
  const line = LINE.exec(value.trim());
  return line && isSafeColor(line[2].trim())
    ? { height: Number(line[1]), color: line[2].trim() }
    : null;
}

/** An element's declarations, by property, as its style text says them. */
function declared(el: Element): Map<string, string> {
  return new Map(
    parseDeclarations(el.getAttribute('style') ?? '').map(({ name, value }) => [
      name.toLowerCase(),
      value.trim(),
    ]),
  );
}
