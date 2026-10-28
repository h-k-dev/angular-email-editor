import { Node, Schema } from 'prosemirror-model';
import { Command } from 'prosemirror-state';
import { isFillTextColor } from './dual-contrast';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { bandTable } from './extensions/nodes/section';
import { spacerStyle } from './extensions/nodes/spacer';
import { parsePadding } from './extensions/nodes/table';
import { parseHTML, serializeToHTML } from './html';
import { paddingOf, paddingSides } from './inline-style';
import { layoutMarker } from './layout-marker';

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

function recognise(node: Node, schema: Schema): AuthoredPageConversion | null {
  if (node.type.name !== 'htmlElement' || node.attrs['tag'] !== 'table') return null;
  const html = serializeToHTML(schema.topNodeType.create(null, node), schema);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.body.querySelector('table');
  if (!table || table.getAttribute('width') !== '100%') return null;
  const rows = Array.from(table.rows);
  if (rows.length < 2 || rows.some((row) => row.cells.length !== 1)) return null;
  const strip = frameStrip(doc, rows[0].cells[0]);
  if (!strip) return null;
  const blocks: HTMLElement[] = [strip];
  for (const row of rows.slice(1)) {
    const band = rowBand(doc, row.cells[0]);
    if (!band) return null;
    blocks.push(band);
  }
  return {
    html: blocks.map((block) => block.outerHTML).join(''),
    spacers: 1,
    sections: blocks.length - 1,
  };
}

/** The first row: the page's own cell round a centred column holding
    nothing — one filled spacer, as tall as the cell's room and the
    column's empty runs together. */
function frameStrip(doc: Document, cell: HTMLTableCellElement): HTMLElement | null {
  const inside = Array.from(cell.children);
  const column = inside.length === 1 ? (inside[0] as HTMLElement) : null;
  if (!column || column.tagName !== 'DIV' || !column.style.maxWidth) return null;
  if (column.textContent?.trim()) return null;
  const runs = Array.from(column.children) as HTMLElement[];
  if (runs.some((run) => run.tagName !== 'DIV' || run.children.length)) return null;
  const vertical = (el: HTMLElement) => {
    const [top, , bottom] = sides(el);
    return top + bottom;
  };
  const height = vertical(cell) + runs.reduce((sum, run) => sum + vertical(run), 0);
  if (!height) return null;
  const spacer = doc.createElement('div');
  spacer.className = layoutMarker('spacer');
  spacer.setAttribute('style', spacerStyle(height, fillOf(cell)));
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
