import { Node, Schema } from 'prosemirror-model';
import { Command } from 'prosemirror-state';
import { isFillTextColor } from './dual-contrast';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { pageRowStyle } from './extensions/nodes/page-row';
import { bandTable } from './extensions/nodes/section';
import { spacerStyle } from './extensions/nodes/spacer';
import { parsePadding } from './extensions/nodes/table';
import { parseHTML, serializeToHTML } from './html';
import { inlinePadding, paddingOf, paddingSides } from './inline-style';
import { layoutMarker, markedAs } from './layout-marker';
import {
  PAGE_WIDTH,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  PageLayout,
  cellPadding,
  tablePageLayout,
} from './page-layout';

/**
 * A page edited by hand, recognised — never repaired. The pattern: a page
 * of ours whose rows were copied straight into its 100% table, beside its
 * column — the first row the page's own cell round an empty centred column
 * (its fill and room above and below, nothing in it), every other row one
 * cell with the row's fill, its room, and its words. The parse keeps it as
 * authored (page-layout.ts strips only our markers); this says what it
 * would be in our own blocks, for the host to suggest:
 *
 * - the empty first row — a strip: one spacer of the page's fill, as tall
 *   as the row;
 * - every other row — a `full` band of its fill and its room above and
 *   below, its side room the band's inset, its words as they stood.
 *
 * The same pixels in a light reader; in a dark one they are drawn dark as
 * any colour is (Dawn). The author decides
 * ({@link convertAuthoredPage}); nothing here runs on its own.
 *
 * A second pattern, the page of rows written by hand (no markers of ours):
 * a 100% table whose one cell holds one table of a fixed width (320–800px)
 * — the column — every row of it one cell, and a fill on the page or on the
 * column. It is the `table` page kind as a hand would code it; offered as
 * one ({@link convertAuthoredPageToRows}), kept as authored until then.
 */

/** What an authored page would be in our blocks: the markup, in order, and
    what it holds — so a host can say what a conversion makes ("to spacer",
    "to sections", both). */
export interface AuthoredPageConversion {
  /** Which pattern: a page of ours with rows pasted beside its column, or
      a page of rows written by hand. */
  shape: 'stray-rows' | 'rows-page';
  /** The strip and bands, in order — null where the pattern has no
      same-pixels conversion (the hand-written page of rows). */
  html: string | null;
  /** Strips (filled spacers) it makes. */
  spacers: number;
  /** Bands (sections) it makes. */
  sections: number;
  /** The page as its author meant it — a page of rows: each row a row of
      ours (its fill and room) in a column of the frame's width on the
      frame's colour, the frame's room above and below. Not the same pixels
      (the rows were full width; here they stand in the column), which is
      why it is the author's choice ({@link convertAuthoredPageToRows}). */
  rows: { html: string; layout: PageLayout };
}

/** Recognised tables, by node: a decoration asks on every state. */
const seen = new WeakMap<Node, AuthoredPageConversion | null>();

/** What the authored table at the top level would be in our blocks — the
    strip and the bands, in order — or null for anything that is not the
    pattern. */
export function authoredPageBands(node: Node, schema: Schema): AuthoredPageConversion | null {
  if (seen.has(node)) return seen.get(node)!;
  const result = recognise(node, schema);
  seen.set(node, result);
  return result;
}

/** Turns the authored page at `pos` into the strip and bands it stands for
    ({@link authoredPageBands}) — one step, undone as one. False where the
    node there is not the pattern. */
export function convertAuthoredPage(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const conversion = node ? authoredPageBands(node, state.schema) : null;
    if (!node || !conversion?.html) return false;
    if (dispatch) {
      // Our own markup, read as ours.
      const blocks = parseHTML(conversion.html, state.schema).content;
      dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, blocks).scrollIntoView());
    }
    return true;
  };
}

/** Turns the authored page at `pos` into the page of rows its author meant
    (`rows` of {@link authoredPageBands}) — the rows in its place, the
    document's page layout set — one step, undone as one. False where the
    node is not the pattern, or the document has a page layout already. */
export function convertAuthoredPageToRows(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const conversion = node ? authoredPageBands(node, state.schema) : null;
    if (!node || !conversion || state.doc.attrs['pageLayout']) return false;
    // A page written by hand is the body's page only where it is the whole
    // body: a block beside it would land in a column it was never in.
    if (conversion.shape === 'rows-page' && state.doc.childCount !== 1) return false;
    if (dispatch) {
      const rows = parseHTML(conversion.rows.html, state.schema).content;
      dispatch(
        state.tr
          .replaceWith(pos, pos + node.nodeSize, rows)
          .setDocAttribute('pageLayout', conversion.rows.layout)
          .scrollIntoView(),
      );
    }
    return true;
  };
}

function recognise(node: Node, schema: Schema): AuthoredPageConversion | null {
  if (node.type.name !== 'htmlElement' || !/^(table|div|center)$/.test(node.attrs['tag'])) {
    return null;
  }
  const html = serializeToHTML(schema.topNodeType.create(null, node), schema);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rowsPage = handCodedPage(doc.body);
  if (rowsPage) return rowsPage;
  if (node.attrs['tag'] !== 'table') return null;
  const table = doc.body.querySelector('table');
  if (!table || table.getAttribute('width') !== '100%') return null;
  const rows = Array.from(table.rows);
  if (rows.length < 2 || rows.some((row) => row.cells.length !== 1)) return null;
  const frame = rows[0].cells[0];
  const top = frameBlocks(doc, frame);
  if (!top) return null;
  // The rows first: the bands below take the cells' words away.
  const pageRows = rows.slice(1).map((row) => rowOfPage(doc, row.cells[0]).outerHTML);
  const blocks: HTMLElement[] = [...top];
  for (const row of rows.slice(1)) {
    const band = rowBand(doc, row.cells[0]);
    if (!band) return null;
    blocks.push(band);
  }
  const column = frame.firstElementChild as HTMLElement;
  const isSpacer = (block: HTMLElement) => block.tagName === 'DIV';
  return {
    shape: 'stray-rows',
    html: blocks.map((block) => block.outerHTML).join(''),
    spacers: blocks.filter(isSpacer).length,
    sections: blocks.filter((block) => !isSpacer(block)).length,
    rows: {
      html: pageRows.join(''),
      layout: tablePageLayout({
        width: parseFloat(column.style.maxWidth) || PAGE_WIDTH,
        background: fillOf(frame),
        // The column's own colour, where it says one: the rows' ground.
        columnBackground: fillOf(column),
        spacing: sides(frame)[0],
        // Every row says its own room.
        rowPadding: 0,
      }),
    },
  };
}

/** A row of the page, as a row of ours: the cell's fill and its room on
    all four sides, its words as they stood (a copy: the band takes the
    originals). */
function rowOfPage(doc: Document, cell: HTMLTableCellElement): HTMLElement {
  const row = doc.createElement('div');
  row.className = layoutMarker('page-row');
  const style = pageRowStyle({
    background: fillOf(cell),
    color: null,
    padding: parsePadding(cell),
  });
  if (style) row.setAttribute('style', style);
  for (const child of Array.from(cell.childNodes)) {
    if (child.nodeType !== 8) row.append(child.cloneNode(true));
  }
  return row;
}

/** The first row: the page's own cell round a centred column holding
    nothing. Of the page's colour alone, one filled spacer as tall as the
    cell's room and the column's empty runs together. A column with a
    colour of its own is a card's top on the page — the page's room above
    and below, the column's height in its colour between, capped at its
    width — so: a spacer of the page's colour, a band of it round a card of
    the column's colour holding the runs' height, and the page's colour
    again. The same pixels either way. */
function frameBlocks(doc: Document, cell: HTMLTableCellElement): HTMLElement[] | null {
  const inside = Array.from(cell.children);
  const column = inside.length === 1 ? (inside[0] as HTMLElement) : null;
  if (!column || column.tagName !== 'DIV' || !column.style.maxWidth) return null;
  if (column.textContent?.trim()) return null;
  const runs = Array.from(column.children) as HTMLElement[];
  if (runs.some((run) => run.tagName !== 'DIV' || run.children.length)) return null;
  const [above, , below] = sides(cell);
  const runsHeight = runs.reduce((sum, run) => {
    const [top, , bottom] = sides(run);
    return sum + top + bottom;
  }, 0);
  const page = fillOf(cell);
  const card = fillOf(column);
  if (!card) {
    const height = above + below + runsHeight;
    return height ? [spacerOf(doc, height, page)] : null;
  }
  const blocks: HTMLElement[] = [];
  if (above) blocks.push(spacerOf(doc, above, page));
  if (runsHeight) {
    const band = bandTable(
      doc,
      {
        background: page,
        padding: '0px',
        inset: 0,
        width: parseFloat(column.style.maxWidth) || PAGE_WIDTH,
        contentBackground: card,
      },
      [spacerOf(doc, runsHeight, null)],
    );
    blocks.push(band);
  }
  if (below) blocks.push(spacerOf(doc, below, page));
  return blocks.length ? blocks : null;
}

function spacerOf(doc: Document, height: number, fill: string | null): HTMLElement {
  const spacer = doc.createElement('div');
  spacer.className = layoutMarker('spacer');
  spacer.setAttribute('style', spacerStyle(height, fill));
  spacer.innerHTML = '&nbsp;';
  return spacer;
}

/** Any other row: a `full` band of the cell's fill and room — where its
    sides are one inset and its text colour, if any, is its fill's pair. */
function rowBand(doc: Document, cell: HTMLTableCellElement): HTMLElement | null {
  const background = fillOf(cell);
  const color = cell.style.color;
  if (color && (!background || !isFillTextColor(color, background))) return null;
  const [top, right, bottom, left] = sides(cell);
  if (right !== left) return null;
  const content = Array.from(cell.childNodes).filter((child) => child.nodeType !== 8);
  if (!content.some((child) => child.nodeType === 1 || child.textContent?.trim())) return null;
  // Words straight in the cell: a block round them, as a band holds.
  const blocks = content.some((child) => child.nodeType === 3 && child.textContent?.trim())
    ? [wrapped(doc, content)]
    : content;
  const padding = paddingOf(`${top}px`, '0px', `${bottom}px`, '0px');
  return bandTable(doc, { background, padding, inset: left, width: 'full' }, blocks);
}

function sides(el: HTMLElement): number[] {
  return paddingSides(parsePadding(el) ?? '0px').map((side) => parseFloat(side) || 0);
}

function fillOf(el: HTMLElement): string | null {
  const raw = el.style.backgroundColor || el.getAttribute('bgcolor') || '';
  return raw && isSafeColor(raw) ? toEmailSafeColor(raw) : null;
}

function wrapped(doc: Document, nodes: ChildNode[]): HTMLElement {
  const div = doc.createElement('div');
  div.append(...nodes);
  return div;
}

/**
 * The page of rows written by hand, unmarked: the body's one block a 100%
 * table (bare, or in plain wrappers) whose one cell holds one table of a
 * fixed width (320–800px) — the column — every row of it a single cell, and
 * a fill on the page or on the column. Each row would be a row of ours
 * (`pageRow`) with the cell's fill and padding, its words in a block
 * carrying the text styles the column and the cell gave them. Anything less
 * exact — a row of two cells, a column of no fixed width — is no such page.
 * Reads a throwaway document: nothing of the email is touched.
 */
function handCodedPage(root: Element): AuthoredPageConversion | null {
  const outer = soleChild(root);
  const page = outer && soleTable(outer);
  if (!page || markedAs(page) || page.rows.length !== 1 || page.rows[0].cells.length !== 1) {
    return null;
  }
  const cell = page.rows[0].cells[0];
  const inside = meaningful(cell);
  const column = inside.length === 1 ? inside[0] : null;
  if (!(column instanceof HTMLTableElement) || markedAs(column)) return null;
  const width = fixedWidth(column);
  if (width === null || width < PAGE_WIDTH_MIN || width > PAGE_WIDTH_MAX) return null;
  const rows = Array.from(column.rows);
  if (!rows.length || rows.some((row) => row.cells.length !== 1)) return null;
  const background = fillOf(cell) ?? fillOf(page);
  const columnBackground = fillOf(column);
  if (!background && !columnBackground) return null;
  const spacing = inlinePadding(cell)?.[0];
  const inherited = textStyles(column);
  return {
    shape: 'rows-page',
    html: null,
    spacers: 0,
    sections: 0,
    rows: {
      html: rows.map((row) => rowOfCell(row.cells[0], inherited).outerHTML).join(''),
      layout: tablePageLayout({
        width,
        background,
        columnBackground,
        spacing: spacing ? parseFloat(spacing) || 0 : 0,
        rowPadding: cellPadding(column),
      }),
    },
  };
}

/** An element's one child that says something — null for none or more. */
function soleChild(el: Element): Element | null {
  const inside = meaningful(el);
  return inside.length === 1 && inside[0] instanceof Element ? inside[0] : null;
}

/** The table `el` is, or holds through plain wrappers (a `div`, a
    `center`) and nothing else — null for anything more. */
function soleTable(el: Element | null): HTMLTableElement | null {
  while (el && /^(DIV|CENTER)$/.test(el.tagName)) el = soleChild(el);
  return el instanceof HTMLTableElement ? el : null;
}

/** An element's children that say something: elements and words — no
    comment, no white space. */
function meaningful(el: Element): ChildNode[] {
  return Array.from(el.childNodes).filter(
    (node) => node.nodeType === 1 || (node.nodeType === 3 && !!node.textContent?.trim()),
  );
}

/** A table's fixed width, px — its `max-width`, its `width` attribute, its
    styled width — or null for one as wide as its room. */
function fixedWidth(table: HTMLTableElement): number | null {
  const px = (value: string | null) => {
    const m = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(value ?? '');
    return m ? Number(m[1]) : null;
  };
  return px(table.style.maxWidth) ?? px(table.getAttribute('width')) ?? px(table.style.width);
}

/** The text styles a row's words take from where they stand. */
const TEXT_STYLES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
] as const;

function textStyles(el: HTMLElement): Map<string, string> {
  const styles = new Map<string, string>();
  for (const property of TEXT_STYLES) {
    const value = el.style.getPropertyValue(property);
    if (value) styles.set(property, value);
  }
  // A fill's paired text colour is the fill's, not the words': the band
  // (or the column) writes it again, and a dark paper re-pairs it.
  const fill = fillOf(el);
  if (fill && isFillTextColor(styles.get('color'), fill)) styles.delete('color');
  const align = el.getAttribute('align');
  if (align && !styles.has('text-align') && /^(left|center|right|justify)$/i.test(align)) {
    styles.set('text-align', align.toLowerCase());
  }
  return styles;
}

/** A hand-coded row as a row of ours (`pageRow`, as it emits): the cell's
    fill and padding, its words in a block with the text styles the column
    and the cell gave them. */
function rowOfCell(cell: HTMLTableCellElement, inherited: Map<string, string>): HTMLElement {
  const doc = cell.ownerDocument;
  const row = doc.createElement('div');
  row.className = layoutMarker('page-row');
  // Through the CSSOM, as the row's own emit is printed — so the row reads
  // as one of ours, not as markup to keep verbatim. A cell with no padding
  // of its own takes the column's (`cellpadding`, the page's rowPadding).
  const style = pageRowStyle({
    background: fillOf(cell),
    color: null,
    padding: parsePadding(cell),
  });
  if (style) row.style.cssText = style;
  const styles = new Map([...inherited, ...textStyles(cell)]);
  const words = Array.from(cell.childNodes);
  if (!styles.size) {
    row.append(...words);
    return row;
  }
  const block = doc.createElement('div');
  for (const [property, value] of styles) block.style.setProperty(property, value);
  block.append(...words);
  row.append(block);
  return row;
}
