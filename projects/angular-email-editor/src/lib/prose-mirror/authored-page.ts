import { Node, Schema } from 'prosemirror-model';
import { Command } from 'prosemirror-state';
import { isFillTextColor } from './dual-contrast';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { pageRowStyle } from './extensions/nodes/page-row';
import { bandTable } from './extensions/nodes/section';
import { spacerStyle } from './extensions/nodes/spacer';
import { parsePadding } from './extensions/nodes/table';
import { parseHTML, serializeToHTML } from './html';
import { paddingOf, paddingSides } from './inline-style';
import { layoutMarker } from './layout-marker';
import { PAGE_WIDTH, PageLayout, tablePageLayout } from './page-layout';

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
 * The same pixels in a light reader; in a dark one our fills take their
 * dark variants, as every band and strip of ours does. The author decides
 * ({@link convertAuthoredPage}); nothing here runs on its own.
 */

/** What an authored page would be in our blocks: the markup, in order, and
    what it holds — so a host can say what a conversion makes ("to spacer",
    "to sections", both). */
export interface AuthoredPageConversion {
  html: string;
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
    if (!node || !conversion) return false;
    if (dispatch) {
      // Our own markup, read as ours in any parse.
      const blocks = parseHTML(conversion.html, state.schema, { mode: 'preserve' }).content;
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
    if (dispatch) {
      const rows = parseHTML(conversion.rows.html, state.schema, { mode: 'preserve' }).content;
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
  if (node.type.name !== 'htmlElement' || node.attrs['tag'] !== 'table') return null;
  const html = serializeToHTML(schema.topNodeType.create(null, node), schema);
  const doc = new DOMParser().parseFromString(html, 'text/html');
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
