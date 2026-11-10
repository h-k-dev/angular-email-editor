import { Fragment, Node, ResolvedPos } from 'prosemirror-model';
import { Command, Transaction } from 'prosemirror-state';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { heldShare } from './extensions/nodes/columns';
import { SECTION_CONTENT_MAX, SectionWidth } from './extensions/nodes/section';
import { DocumentEnvelope } from './envelope';
import { inlinePadding, paddingOf, parseDeclarations } from './inline-style';
import { AttributePairs } from './verbatim';

/**
 * A band of a compiled MJML email, recognised — never repaired. MJML writes
 * a section as a `<div>` capped at the body's width (`max-width: 600px`,
 * auto side margins) round a presentation table of one cell, the band's
 * fill on the div and the table, its room on the cell; in the cell its
 * columns, each a `div.mj-column-per-N` (or `-px-N`) inline-block holding
 * the column's content in a table of its own; and round all of it Outlook's
 * ghost tables in `[if mso | IE]` comments. Ours is the reverse — a
 * presentation table round a centred `<div>` (section.ts) — so the parse
 * keeps MJML's verbatim, every band an element of its own.
 *
 * This says what a band would be in our blocks, for the host to suggest:
 *
 * - the band — a section of its fill, its room above and below, its side
 *   room the inset, its cap the width (a band a centred page centres, the
 *   page's width; one standing alone in a wrapper, `full`);
 * - its columns — a columns block, each column capped at exactly its share
 *   of the row, as MJML drew it ({@link columnCap}), its vertical
 *   alignment, its content exactly as written. One full-width column is no
 *   columns block: its content is the section's;
 * - a group of columns (`mj-group`: one full-width `div` of no type of its
 *   own round columns that say their share themselves, `width: 50%`, and
 *   so keep it on a phone instead of stacking) — the same columns block,
 *   each column holding its share (`hold`, columns.ts).
 *
 * Only what a section can say is offered: a band with corners, a class of
 * its own, an image behind it (VML) or anything else a section cannot
 * carry keeps its markup — its columns alone may still be offered as ours
 * ({@link convertAuthoredColumns}). The author decides
 * ({@link convertAuthoredBand}, {@link convertAuthoredBands}); nothing here
 * runs on its own. Read off the attributes' text, never the CSSOM (an
 * engine's reading of MJML's `background:` shorthand differs).
 */

/** What a column of MJML's is in a row: its share, percent, and where its
    content sits beside a taller neighbour. */
export interface AuthoredColumn {
  percent: number;
  valign: 'top' | 'middle' | 'bottom';
  /** Keeps its share of the row on a phone instead of stacking — a column
      of MJML's group. */
  hold: boolean;
}

/** What an MJML band would be in our blocks. */
export interface AuthoredBand {
  /** The section it stands for — null where the band says what a section
      cannot (corners, a class, an image). */
  section: {
    /** The band's fill, email-safe hex — null for none. */
    fill: string | null;
    /** Its cap, px — null for a band that no longer centres itself (a
        centred page of ours centres it). */
    width: number | null;
    /** Its room above and below, and at the sides, px. */
    top: number;
    bottom: number;
    inset: number;
  } | null;
  /** Its columns, in order. */
  columns: AuthoredColumn[];
  /** The whole band converts: a section, and its columns a columns block —
      two or more, or one as wide as the band. */
  convertible: boolean;
  /** Its columns alone convert (two or more), the band kept as written. */
  columnsConvertible: boolean;
}

/** Recognised bands, by node: a decoration asks on every state. */
const seenBands = new WeakMap<Node, AuthoredBand | null>();

/** What the element at hand would be in our blocks, if it is an MJML band:
    `div > table > tbody > tr > td`, the cell holding MJML's columns and
    their ghost comments, nothing else — null for anything that is not. */
export function authoredBand(node: Node): AuthoredBand | null {
  if (node.type.name !== 'htmlElement') return null;
  let known = seenBands.get(node);
  if (known === undefined) {
    known = recogniseBand(node);
    seenBands.set(node, known);
  }
  return known;
}

/** The columns a node holds, if they are MJML's: every child an
    `mj-column-*` div or a ghost comment of Outlook's, one column at least
    — or one group of them ({@link groupOf}), its columns then — their
    shares of a row `contentWidth` px wide (a `px` column's width is one of
    them). Null for anything else. */
export function authoredColumns(
  node: Node,
  contentWidth: number = SECTION_CONTENT_MAX,
): AuthoredColumn[] | null {
  const raw = rawColumns(node);
  return raw && raw.map((column) => sharedColumn(column, contentWidth));
}

/** Every band of the document an author could convert — or whose columns
    they could — by position, in document order. */
export function authoredBandPositions(doc: Node): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock || node.isAtom) return false;
    const band = authoredBand(node);
    if (band && (band.convertible || band.columnsConvertible)) {
      found.push(pos);
      return false;
    }
    return true;
  });
  return found;
}

/** Turns the MJML band at `pos` into the section (and columns) it stands
    for ({@link authoredBand}) — its content exactly as written, and the
    ghost tables Outlook drew it with gone, since our section and columns
    draw their own. The ghost comments are touched only here: the one
    before the band keeps what closes the band above, the one after what
    opens the band below. One step, undone as one. False where the node is
    not such a band. */
export function convertAuthoredBand(pos: number): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    if (!convertBand(tr, pos)) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Every MJML band of the document that converts, converted
    ({@link convertAuthoredBand}) — one step, undone as one. False where
    none does. */
export function convertAuthoredBands(): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    if (!convertBands(tr)) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** Converts every band of `tr`'s document that converts, the last first
    (an earlier one's position stays where it was) — whether any did. */
export function convertBands(tr: Transaction): boolean {
  const positions = authoredBandPositions(tr.doc).filter(
    (pos) => authoredBand(tr.doc.nodeAt(pos)!)?.convertible,
  );
  for (const pos of positions.reverse()) convertBand(tr, pos);
  return positions.length > 0;
}

/** Turns the MJML columns the node at `pos` holds — a band's cell (or the
    band, kept as written: its cell's), or any block holding nothing but
    them — into a columns block of ours ({@link authoredColumns}), their
    content exactly as written, the ghost comments between them gone (ours
    writes its own). One step, undone as one. False where the node holds
    anything else, or no row of two columns or more. */
export function convertAuthoredColumns(pos: number): Command {
  return (state, dispatch) => {
    let node = state.doc.nodeAt(pos);
    if (node && authoredBand(node)) {
      node = cellOf(node);
      // The band's div, table, tbody and row open before the cell.
      pos += 4;
    }
    if (!node) return false;
    const row = rowWidth(node);
    const shares = authoredColumns(node, row);
    if (!shares || shares.length < 2 || !isRow(shares)) return false;
    const block = columnsBlock(node, shares, row);
    if (!block || !node.type.validContent(Fragment.from(block))) return false;
    dispatch?.(state.tr.replaceWith(pos + 1, pos + node.nodeSize - 1, block).scrollIntoView());
    return true;
  };
}

/** The band at `pos` in `tr`, converted — false where it does not. */
function convertBand(tr: Transaction, pos: number): boolean {
  const node = tr.doc.nodeAt(pos);
  const band = node ? authoredBand(node) : null;
  if (!node || !band?.convertible || !band.section) return false;
  const $pos = tr.doc.resolve(pos);
  const section = sectionOf(tr.doc, $pos, node, band);
  if (!section || !$pos.parent.type.validContent(Fragment.from(section))) return false;
  const end = pos + node.nodeSize;
  const before = $pos.nodeBefore;
  const after = tr.doc.resolve(end).nodeAfter;
  const ghosts = ghostEnds(before, after);
  // Back to front: what is before a change keeps its position.
  if (ghosts && after) setComment(tr, end, after, ghosts.after);
  tr.replaceWith(pos, end, section);
  if (ghosts && before) setComment(tr, pos - before.nodeSize, before, ghosts.before);
  return true;
}

/** A comment's new text — gone where nothing is left in it. */
function setComment(tr: Transaction, pos: number, comment: Node, text: string): void {
  if (EMPTY_CONDITIONAL.test(text)) tr.delete(pos, pos + comment.nodeSize);
  else tr.setNodeMarkup(pos, null, { ...comment.attrs, text });
}

/** The section a band stands for, round its columns (or its one column's
    content) — null where the content does not fit our blocks. */
function sectionOf(doc: Node, $pos: ResolvedPos, node: Node, band: AuthoredBand): Node | null {
  const shape = band.section!;
  const cell = cellOf(node)!;
  const schema = doc.type.schema;
  const around = surroundingFill(doc, $pos);
  const centred = shape.width !== null;
  // Centred alone, the band's fill is its own column's — a card on what is
  // round it; centred by a page of ours, it fills the page's column.
  const width: SectionWidth = centred
    ? shape.width!
    : doc.attrs['pageLayout']
      ? SECTION_CONTENT_MAX
      : 'full';
  // The row its columns share: the content inside the side room.
  const page = (doc.attrs['pageLayout'] as { width?: number } | null)?.width;
  const row = (typeof width === 'number' ? width : (page ?? SECTION_CONTENT_MAX)) - 2 * shape.inset;
  const attrs = {
    background: centred ? around : (shape.fill ?? around),
    contentBackground: centred ? shape.fill : null,
    padding: paddingOf(`${shape.top}px`, '0px', `${shape.bottom}px`, '0px'),
    image: null,
    inset: shape.inset,
    width,
  };
  const content =
    band.columns.length === 1
      ? columnDivs(cell)[0].content
      : Fragment.fromArray([columnsBlock(cell, band.columns, row)].filter((n): n is Node => !!n));
  if (!content.childCount) return null;
  try {
    return schema.nodes['section'].createChecked(attrs, content);
  } catch {
    return null;
  }
}

/** Our columns block for the MJML columns `holder` holds, each its share
    of a `row` px wide — null where a column's content is no column's. */
function columnsBlock(holder: Node, shares: AuthoredColumn[], row: number): Node | null {
  const schema = holder.type.schema;
  try {
    const columns = columnDivs(holder).map((div, index) =>
      schema.nodes['column'].createChecked(
        {
          maxWidth: columnCap(shares[index].percent, row),
          valign: shares[index].valign,
          // A group's column: the share it said, kept on a phone.
          hold: shares[index].hold ? heldShare(shares[index].percent) : false,
        },
        div.content,
      ),
    );
    return schema.nodes['columns'].createChecked(null, columns);
  } catch {
    return null;
  }
}

/** A column's cap: exactly its share of the row, px — MJML's own width, so
    the converted row draws as it did. Not our new columns' budget
    (columns.ts): the author's widths are kept, and with them MJML's
    bargain — a row as wide as its band stacks where a client gives it less
    than the band's width. Down, never up, so a row never outgrows its
    band (a third of 600 is 199.99…, and 200). */
export function columnCap(percent: number, row: number): number {
  return Math.max(1, Math.floor((row * percent) / 100 + 1e-6));
}

/** The colour round a band — what shows beside a centred one: the nearest
    element round it with a fill, else the body's. What the parse reads a
    band's own fill as when its cell says none (section.ts), so the band
    reads back as written. */
function surroundingFill(doc: Node, $pos: ResolvedPos): string | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const fill = fillOf($pos.node(depth));
    if (fill) return fill;
  }
  const body = (doc.attrs['envelope'] as DocumentEnvelope | null | undefined)?.body ?? [];
  return pairsFill(body);
}

/** The ghost comments round a band, each with the band's own part taken
    out — the one before ends opening its ghost table, the one after starts
    closing it — or null where they are not that (left as they are: the
    section then stands in Outlook's cell, which draws it all the same). */
function ghostEnds(
  before: Node | null | undefined,
  after: Node | null | undefined,
): { before: string; after: string } | null {
  const open = before?.type.name === 'htmlComment' ? (before.attrs['text'] as string) : null;
  const close = after?.type.name === 'htmlComment' ? (after.attrs['text'] as string) : null;
  if (!open || !close || !GHOST_OPEN_TAIL.test(open) || !GHOST_CLOSE_HEAD.test(close)) return null;
  return {
    before: open.replace(GHOST_OPEN_TAIL, ''),
    after: close.replace(GHOST_CLOSE_HEAD, '$1'),
  };
}

/** A conditional comment holding nothing but a ghost table's tags. */
const GHOST = /^\[if [^\]]*mso[^\]]*\]>(?:\s*<\/?(?:table|tbody|tr|td)\b[^>]*>)*\s*<!\[endif\]$/i;
/** The ghost table a band opens, at a comment's end. */
const GHOST_OPEN_TAIL = /<table\b[^>]*>\s*<tr\b[^>]*>\s*<td\b[^>]*>\s*(?=<!\[endif\]$)/i;
/** The ghost table a band closes, at a comment's start. */
const GHOST_CLOSE_HEAD = /^(\[if [^\]]*mso[^\]]*\]>)\s*<\/td>\s*<\/tr>\s*<\/table>/i;
/** A conditional comment with nothing left in it. */
const EMPTY_CONDITIONAL = /^\[if [^\]]*\]>\s*<!\[endif\]$/i;

const isGhost = (node: Node): boolean =>
  node.type.name === 'htmlComment' && GHOST.test(node.attrs['text'] as string);

function recogniseBand(node: Node): AuthoredBand | null {
  if (!isElement(node, 'div') || node.childCount !== 1) return null;
  const table = node.child(0);
  if (!isElement(table, 'table') || attrOf(table, 'role') !== 'presentation') return null;
  const cell = cellOf(node);
  const raw = cell && rawColumns(cell);
  if (!cell || !raw) return null;
  const room = cellRoom(cell);
  const width = bandWidth(node);
  const contentWidth = (width || SECTION_CONTENT_MAX) - 2 * (room?.inset ?? 0);
  const columns = raw.map((column) => sharedColumn(column, contentWidth));
  const section =
    room && width !== false && bandMarkupFits(node, table, cell)
      ? { fill: bandFill(node, table), width, ...room }
      : null;
  const row = columns.length > 1 && isRow(columns);
  return {
    section,
    columns,
    convertible: !!section && (row || (columns.length === 1 && columns[0].percent >= 100)),
    columnsConvertible: row,
  };
}

/** Columns that stand side by side: their shares one row at most. Wider —
    MJML's full-width columns one under another — is no row of ours. */
function isRow(columns: AuthoredColumn[]): boolean {
  return columns.reduce((sum, column) => sum + column.percent, 0) <= 100.5;
}

/** The band's one cell: `table > tbody > tr > td`, each the only child. */
function cellOf(band: Node): Node | null {
  let node = band;
  for (const tag of ['table', 'tbody', 'tr', 'td']) {
    if (node.childCount !== 1 || !isElement(node.child(0), tag)) return null;
    node = node.child(0);
  }
  return node;
}

/** What a holder holds beside Outlook's ghost comments, in order. */
function ownChildren(holder: Node): Node[] {
  const own: Node[] = [];
  holder.forEach((child) => {
    if (!isGhost(child)) own.push(child);
  });
  return own;
}

/** The `mj-column-*` divs a holder holds, in order — its group's, where
    it holds one ({@link groupOf}). */
function columnDivs(holder: Node): Node[] {
  return ownChildren(groupOf(holder) ?? holder);
}

/** What MJML's group may say of itself: a full-width inline-block with no
    type of its own, so nothing stands between its columns. A fill, or
    anything else, is more than a columns block says. */
const GROUP_DECLARATIONS: Record<string, (value: string) => boolean> = {
  'font-size': (value) => /^0(?:px)?$/.test(value),
  'line-height': (value) => /^0(?:px)?$/.test(value),
  'text-align': (value) => value === 'left',
  direction: (value) => value === 'ltr',
  display: (value) => value === 'inline-block',
  'vertical-align': (value) => /^(top|middle|bottom)$/.test(value),
  width: (value) => value === '100%',
};

const seenGroups = new WeakMap<Node, Node | null>();

/** The group a holder holds and nothing else beside Outlook's ghosts —
    MJML's `mj-group`: a `div.mj-column-per-100` round columns that each say
    their share of it (`width: 50%`), which is how they keep it on a phone.
    Null for anything else. */
function groupOf(holder: Node): Node | null {
  let known = seenGroups.get(holder);
  if (known === undefined) {
    known = readGroup(holder);
    seenGroups.set(holder, known);
  }
  return known;
}

function readGroup(holder: Node): Node | null {
  if (holder.isTextblock || holder.isAtom) return null;
  const [group, ...others] = ownChildren(holder);
  if (!group || others.length || !isElement(group, 'div')) return null;
  if (pairsOf(group).some(([name]) => name !== 'class' && name !== 'style')) return null;
  const classes = (attrOf(group, 'class') ?? '').split(/\s+/).filter(Boolean);
  if (!classes.includes('mj-column-per-100')) return null;
  // A class of the author's is drawn by their head: no group of ours.
  if (classes.some((name) => name !== 'mj-column-per-100' && name !== 'mj-outlook-group-fix')) {
    return null;
  }
  for (const [name, value] of styleOf(group)) {
    if (!GROUP_DECLARATIONS[name]?.(value)) return null;
  }
  const columns = ownChildren(group);
  return columns.length && columns.every((column) => columnOf(column, true)) ? group : null;
}

interface RawColumn {
  unit: 'per' | 'px';
  value: number;
  valign: AuthoredColumn['valign'];
  hold: boolean;
}

const seenColumns = new WeakMap<Node, RawColumn[] | null>();

function rawColumns(holder: Node): RawColumn[] | null {
  let known = seenColumns.get(holder);
  if (known === undefined) {
    known = readColumns(holder);
    seenColumns.set(holder, known);
  }
  return known;
}

function readColumns(holder: Node): RawColumn[] | null {
  if (holder.isTextblock || holder.isAtom || !holder.childCount) return null;
  const group = groupOf(holder);
  const columns: RawColumn[] = [];
  for (const child of ownChildren(group ?? holder)) {
    const column = columnOf(child, !!group);
    if (!column) return null;
    columns.push(column);
  }
  return columns.length ? columns : null;
}

/** MJML's column class: its share, `per-33-333333333333336` or `px-200`. */
const COLUMN_CLASS = /^mj-column-(per|px)-(\d+(?:-\d+)?)$/;

/** What an MJML column's own style may say: what makes it an inline-block
    of its share (the head's rule) and what its content takes from it, as
    MJML writes them. Anything else — a column styled by hand — is no
    column of ours. */
const COLUMN_DECLARATIONS: Record<string, (value: string) => boolean> = {
  // MJML's 0px between the inline-blocks; the content says its own.
  'font-size': () => true,
  'text-align': (value) => value === 'left',
  direction: (value) => value === 'ltr',
  display: (value) => value === 'inline-block',
  'vertical-align': (value) => /^(top|middle|bottom)$/.test(value),
  width: (value) => value === '100%',
};

/** A share a group's column says itself: `width: 50%`. */
const SHARE = /^(\d+(?:\.\d+)?)%$/;

/** What an `mj-column-*` div is, or null for a div that is none. `held`
    reads it as a group's column: its width its own share of the group —
    what its class says, in percent — where a column of a band says the
    whole width and leaves its share to the head's rule. */
function columnOf(node: Node, held = false): RawColumn | null {
  if (!isElement(node, 'div') || !node.childCount) return null;
  if (pairsOf(node).some(([name]) => name !== 'class' && name !== 'style')) return null;
  let share: RegExpExecArray | null = null;
  for (const name of (attrOf(node, 'class') ?? '').split(/\s+/).filter(Boolean)) {
    const match = COLUMN_CLASS.exec(name);
    if (match && !share) share = match;
    // A class of the author's is drawn by their head: not a column of ours.
    else if (name !== 'mj-outlook-group-fix') return null;
  }
  if (!share) return null;
  const style = styleOf(node);
  for (const [name, value] of style) {
    // A group's column: its width is read below, against its class.
    if (held && name === 'width') continue;
    if (!COLUMN_DECLARATIONS[name]?.(value)) return null;
  }
  const value = Number(share[2].replace('-', '.'));
  if (held) {
    const own = SHARE.exec(style.get('width') ?? '');
    if (share[1] !== 'per' || !own || Math.abs(Number(own[1]) - value) > 0.01) return null;
  }
  return {
    unit: share[1] as RawColumn['unit'],
    value,
    valign: (style.get('vertical-align') as AuthoredColumn['valign'] | undefined) ?? 'top',
    hold: held,
  };
}

function sharedColumn(column: RawColumn, contentWidth: number): AuthoredColumn {
  const percent =
    column.unit === 'per' ? column.value : (column.value / Math.max(1, contentWidth)) * 100;
  return { percent, valign: column.valign, hold: column.hold };
}

/** The row a holder's px columns share: our width, a section's content;
    else MJML's body less the holder's own side room. */
function rowWidth(holder: Node): number {
  if (holder.type.name === 'section') {
    const width = holder.attrs['width'] as SectionWidth;
    return (typeof width === 'number' ? width : SECTION_CONTENT_MAX) - 2 * holder.attrs['inset'];
  }
  const room = holder.type.name === 'htmlElement' ? cellRoom(holder) : null;
  return SECTION_CONTENT_MAX - 2 * (room?.inset ?? 0);
}

/** The cell's room, px — above, below, and at the sides alike — or null
    where it says one a section cannot (a side of its own, not px). */
function cellRoom(cell: Node): { top: number; bottom: number; inset: number } | null {
  const probe = document.createElement('div');
  probe.setAttribute('style', attrOf(cell, 'style') ?? '');
  const sides = inlinePadding(probe) ?? ['0', '0', '0', '0'];
  const px = sides.map((side) => {
    const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(side);
    return match && (match[2] || Number(match[1]) === 0) ? Number(match[1]) : null;
  });
  const [top, right, bottom, left] = px;
  if (top === null || right === null || bottom === null || left === null || left !== right) {
    return null;
  }
  return { top, bottom, inset: left };
}

/** The band's cap, px — null for a band that does not centre itself, false
    for one that is no centred column of one width (a cap without the auto
    margins, room above or below). */
function bandWidth(band: Node): number | null | false {
  const style = styleOf(band);
  const margin = (style.get('margin') ?? '').split(/\s+/).filter(Boolean);
  const [top = '0', right = top, bottom = top, left = right] = margin;
  const zero = (side: string | undefined) => !side || /^0(?:px)?$/.test(side);
  if (!zero(top) || !zero(bottom)) return false;
  if (!zero(style.get('margin-top')) || !zero(style.get('margin-bottom'))) return false;
  const cap = style.get('max-width');
  if (cap === undefined) return margin.length || style.has('margin-left') ? false : null;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(cap);
  const auto =
    (style.get('margin-left') ?? left) === 'auto' &&
    (style.get('margin-right') ?? right) === 'auto';
  return px && auto ? Number(px[1]) : false;
}

/** What a band's div, table and cell may say for a section to draw it the
    same: the fill, the cap and its centring, the table's own frame, the
    cell's room and what its columns take from it. Anything else — corners,
    a shadow, a class, an image — is the author's, kept as written. */
const BAND_DECLARATIONS = new Set([
  'background',
  'background-color',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'max-width',
]);
const TABLE_DECLARATIONS = new Set(['background', 'background-color', 'width']);
const CELL_DECLARATIONS = new Set([
  'direction',
  'font-size',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'text-align',
]);
const TABLE_ATTRIBUTES = new Set([
  'align',
  'border',
  'cellpadding',
  'cellspacing',
  'role',
  'style',
]);

function bandMarkupFits(band: Node, table: Node, cell: Node): boolean {
  if (pairsOf(band).some(([name]) => name !== 'style')) return false;
  if (pairsOf(table).some(([name]) => !TABLE_ATTRIBUTES.has(name))) return false;
  if (pairsOf(cell).some(([name]) => name !== 'style')) return false;
  const fits = (node: Node, allowed: Set<string>) =>
    Array.from(styleOf(node)).every(
      ([name, value]) => allowed.has(name) && !/url\s*\(/i.test(value),
    );
  if (!fits(band, BAND_DECLARATIONS) || !fits(table, TABLE_DECLARATIONS)) return false;
  if (!fits(cell, CELL_DECLARATIONS) || styleOf(cell).get('direction') === 'rtl') return false;
  const tableWidth = styleOf(table).get('width');
  if (tableWidth !== undefined && tableWidth !== '100%') return false;
  // The table's fill, where it says one, is the band's.
  const own = bandFill(band, null);
  const onTable = fillOf(table);
  return !onTable || !own || onTable === own;
}

/** The band's fill: its div's, else its table's. */
function bandFill(band: Node, table: Node | null): string | null {
  return fillOf(band) ?? (table ? fillOf(table) : null);
}

/** An element's fill as its style text (or `bgcolor`) says it — email-safe
    hex, or null for none, `transparent` or `none`. */
function fillOf(node: Node): string | null {
  return node.type.name === 'htmlElement' ? pairsFill(pairsOf(node)) : null;
}

function pairsFill(pairs: AttributePairs): string | null {
  const style = declarations(pairs.find(([name]) => name === 'style')?.[1] ?? '');
  const raw =
    style.get('background-color') ??
    style.get('background') ??
    pairs.find(([name]) => name === 'bgcolor')?.[1] ??
    '';
  return raw && isSafeColor(raw) ? toEmailSafeColor(raw) : null;
}

function isElement(node: Node, tag: string): boolean {
  return node.type.name === 'htmlElement' && node.attrs['tag'] === tag;
}

function pairsOf(node: Node): AttributePairs {
  return (node.attrs['attrs'] as AttributePairs | undefined) ?? [];
}

function attrOf(node: Node, name: string): string | null {
  return pairsOf(node).find(([key]) => key === name)?.[1] ?? null;
}

function styleOf(node: Node): Map<string, string> {
  return declarations(attrOf(node, 'style') ?? '');
}

function declarations(style: string): Map<string, string> {
  return new Map(
    parseDeclarations(style).map(({ name, value }) => [name.toLowerCase(), value.trim()]),
  );
}
