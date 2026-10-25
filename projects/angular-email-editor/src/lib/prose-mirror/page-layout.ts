import { emailBackgroundPalette, fillTextColor } from './dual-contrast';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { SECTION_CONTENT_MAX, SECTION_INSET } from './extensions/nodes/section';
import { layoutMarker, markedAs } from './layout-marker';

/**
 * The page layout — how the whole email stands in the reader's window: the
 * document's `pageLayout` attribute, never a block of it. One per email,
 * round everything, set where the email is designed (a design tool's page
 * settings) and kept by every edit of the text; `null` is no layout, the
 * body as the composer writes it.
 *
 * The first kind, `centered`, is the newsletter's page: a colour across the
 * window (`background`) and the text in a column of `width` px down its
 * middle, with a colour of its own (`columnBackground`) and the page's room
 * above and below it (`spacing`, the page cell's padding) — MJML's `mj-body`,
 * learned from what MJML produces, not from how.
 *
 * **One column, everything in it.** The whole body stands in the column —
 * sections too: a band is a card's band (a hero at the top of the card),
 * not a stripe across the window; what runs edge to edge is a layout
 * element of its own (a preheader, still to come). The column is a capped
 * `<div>` (`aee-layout-page-column`) carrying the column's colour, on a
 * 100% table with the page's (`aee-layout-page`) — a cell's `bgcolor` *and*
 * inline style, as a band carries its fill — because webmail drops the
 * `<body>` and its styles; `emailDocument` paints the body too, for the
 * clients that keep it. Inside the column a section fills its width, its
 * inner column the layout's; the blocks between sections stand in a run
 * (`aee-layout-page-run`) with the column's inset round them, so text
 * never touches the column's edge and lines up with a band's.
 *
 * **Outlook's ghost table.** The column is a `<div>` with a `max-width`:
 * fluid on a phone with no media query (Gmail's app strips the head), at
 * most the width everywhere else — except Outlook on Windows, whose Word
 * engine ignores `max-width` and would run the text across a 2000px window.
 * So the column sits in a fixed-width table that only Outlook sees, opened
 * and closed in `[if mso]` comments round the div — MJML's way: the
 * content is written once, and every other client discards the comments.
 * The table's cell carries the column's colour, which Word does not read off
 * a div. (Word ignores a div's padding too: there a run's text meets the
 * column's edge, as a band's does — the graceful half.)
 *
 * **On parse** the page comes off before anything else reads the markup
 * ({@link liftPageLayout}): the outermost `aee-layout-page` becomes the
 * attribute, and its column, runs, comments and sections' widths go back to
 * the blocks they wrapped — so the body reads, and round-trips, exactly as
 * it does without a layout. A page inside the body (a quoted message that
 * had one) is unwrapped the same way, its layout dropped.
 */
export type PageLayout = CenteredPageLayout;

export interface CenteredPageLayout {
  readonly kind: 'centered';
  /** The column's width, px — {@link PAGE_WIDTH} by default, within
      {@link PAGE_WIDTH_MIN}–{@link PAGE_WIDTH_MAX}, in 4px steps. */
  readonly width: number;
  /** The page's colour round the column, as hex — or null for none. */
  readonly background: string | null;
  /** The column's own colour, as hex — or null for the page's. */
  readonly columnBackground: string | null;
  /** The page's room above and below the column, px — 0 to
      {@link PAGE_SPACING_MAX}, in 4px steps: the column a card on the page
      rather than a stripe down it. 0 is none. */
  readonly spacing: number;
}

/** The email's classic measure — and a section's (section.ts). */
export const PAGE_WIDTH = SECTION_CONTENT_MAX;
/** The narrowest column: a phone's. */
export const PAGE_WIDTH_MIN = 320;
/** The widest: past it, lines grow too long to read in a desktop client. */
export const PAGE_WIDTH_MAX = 800;

/** The most room above and below the column. */
export const PAGE_SPACING_MAX = 96;

/** A new centred page's room above and below its column. */
export const PAGE_SPACING = 32;

/** The room round the text inside a column — a section's inline inset, so
    the text in a column and in a band line up. */
export const PAGE_COLUMN_INSET = SECTION_INSET;

/** A centred page: the palette's grey round a white column, 600px, with
    {@link PAGE_SPACING} above and below it — the newsletter's look — with
    any of it overridden. */
export function centeredPageLayout(
  layout: Partial<Omit<CenteredPageLayout, 'kind'>> = {},
): CenteredPageLayout {
  return normalizePageLayout({
    kind: 'centered',
    width: PAGE_WIDTH,
    background: paletteValue('Gray'),
    columnBackground: paletteValue('White'),
    spacing: PAGE_SPACING,
    ...layout,
  })!;
}

/** A layout as the document may hold it — or null for anything that is not
    one. The width and the room snap to their 4px grid within their bounds
    (no room said is none); a colour that is not a safe one is dropped. */
export function normalizePageLayout(value: unknown): PageLayout | null {
  if (!value || typeof value !== 'object') return null;
  const layout = value as Record<string, unknown>;
  if (layout['kind'] !== 'centered') return null;
  const raw = Number(layout['width']);
  const width = Number.isFinite(raw)
    ? Math.min(PAGE_WIDTH_MAX, Math.max(PAGE_WIDTH_MIN, Math.round(raw / 4) * 4))
    : PAGE_WIDTH;
  const room = Number(layout['spacing']);
  const spacing = Number.isFinite(room)
    ? Math.min(PAGE_SPACING_MAX, Math.max(0, Math.round(room / 4) * 4))
    : 0;
  return {
    kind: 'centered',
    width,
    background: color(layout['background']),
    columnBackground: color(layout['columnBackground']),
    spacing,
  };
}

/** Whether two layouts are the same — null included. */
export function samePageLayout(a: PageLayout | null, b: PageLayout | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.width === b.width &&
    a.background === b.background &&
    a.columnBackground === b.columnBackground &&
    a.spacing === b.spacing
  );
}

function paletteValue(name: string): string | null {
  return emailBackgroundPalette.find((entry) => entry.name === name)?.value ?? null;
}

function color(raw: unknown): string | null {
  return typeof raw === 'string' && isSafeColor(raw) ? toEmailSafeColor(raw) : null;
}

// ─── Emit ─────────────────────────────────────────────────────────────────

/**
 * Wraps a serialized body (the children of `container`) in its page: the
 * 100% table with the page's colour, the capped column inside Outlook's
 * ghost table, and in it the runs of blocks between sections, each with the
 * column's inset, and the sections at the layout's width.
 */
export function wrapPageLayout(container: HTMLElement, layout: PageLayout): void {
  const doc = container.ownerDocument;
  const table = doc.createElement('table');
  table.className = layoutMarker('page');
  setAttributes(table, {
    role: 'presentation',
    width: '100%',
    cellpadding: '0',
    cellspacing: '0',
    border: '0',
  });
  table.style.cssText = 'width: 100%; border-collapse: collapse;';
  const cell = table.createTBody().insertRow().insertCell();
  // The room above and below the column: the page cell's padding — the one
  // padding Outlook's Word engine honours, on a cell.
  const room = layout.spacing ? `padding: ${layout.spacing}px 0px;` : '';
  if (layout.background) cell.setAttribute('bgcolor', layout.background);
  const style = [room, layout.background ? fillStyle(layout.background) : '']
    .filter(Boolean)
    .join(' ');
  if (style) cell.style.cssText = style;
  const column = doc.createElement('div');
  column.className = layoutMarker('page-column');
  column.style.cssText =
    `max-width: ${layout.width}px; margin: 0 auto;` +
    (layout.columnBackground ? ` ${fillStyle(layout.columnBackground)}` : '');

  let run: ChildNode[] = [];
  const flush = () => {
    if (run.length) column.append(runOf(doc, run));
    run = [];
  };
  for (const child of Array.from(container.childNodes)) {
    if (child instanceof HTMLElement && markedAs(child) === 'section') {
      flush();
      setSectionWidth(child, layout.width);
      column.append(child);
    } else {
      run.push(child);
    }
  }
  flush();
  cell.append(doc.createComment(ghostOpen(layout)), column, doc.createComment(GHOST_CLOSE));
  container.replaceChildren(table);
}

/** The blocks between two sections, with the column's inset round them. */
function runOf(doc: Document, nodes: ChildNode[]): HTMLElement {
  const run = doc.createElement('div');
  run.className = layoutMarker('page-run');
  run.style.cssText = `padding: ${PAGE_COLUMN_INSET}px;`;
  run.append(...nodes);
  return run;
}

const ghostOpen = ({ width, columnBackground }: PageLayout): string =>
  `[if mso]><table role="presentation" align="center" width="${width}" cellpadding="0" ` +
  'cellspacing="0" border="0"><tr>' +
  (columnBackground
    ? `<td bgcolor="${columnBackground}" style="${fillStyle(columnBackground)}">`
    : '<td>') +
  '<![endif]';

const GHOST_CLOSE = '[if mso]></td></tr></table><![endif]';

/** A fill and the text it pairs (dual-contrast.ts), as a band writes them. */
const fillStyle = (background: string): string =>
  `background-color: ${background}; color: ${fillTextColor(background)};`;

function setAttributes(el: Element, attrs: Record<string, string>): void {
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
}

/** A section's inner column (its cell's one div, the VML
    comments round it aside), capped at `width` — on the attribute's own
    words, so the rest of the style reads back exactly as the section wrote
    it (a CSSOM write would respell it). */
function setSectionWidth(section: HTMLElement, width: number): void {
  const inner = sectionInner(section);
  const style = inner?.getAttribute('style');
  if (!inner || !style) return;
  inner.setAttribute('style', style.replace(/max-width:\s*[\d.]+px/i, `max-width: ${width}px`));
}

function sectionInner(section: HTMLElement): HTMLElement | null {
  const cell = (section as HTMLTableElement).rows?.[0]?.cells[0];
  const inner = cell ? Array.from(cell.children).find((child) => child.tagName === 'DIV') : null;
  return (inner as HTMLElement | undefined) ?? null;
}

// ─── Parse ────────────────────────────────────────────────────────────────

/**
 * Takes the page off a parsed body, before anything else reads it: returns
 * the layout of the outermost `aee-layout-page` — one not inside a table
 * or a quote — and unwraps every page in `root`, so what is left is the
 * body exactly as it was serialized before {@link wrapPageLayout}. Null
 * when the body has no page of its own.
 */
export function liftPageLayout(root: Element): PageLayout | null {
  const pages = Array.from(root.querySelectorAll('table')).filter(
    (table) => markedAs(table) === 'page',
  );
  let layout: PageLayout | null = null;
  for (const page of pages) {
    if (!layout && outermost(page, root)) layout = readPage(page);
    unwrapPage(page);
  }
  return layout;
}

/** Whether a page stands at the body's own level: nothing round it but
    plain wrappers (the email's `role="article"` div, a client's). */
function outermost(page: Element, root: ParentNode): boolean {
  for (let el = page.parentElement; el && el !== root; el = el.parentElement) {
    if (/^(TABLE|TD|TH|BLOCKQUOTE|LI)$/.test(el.tagName)) return false;
  }
  return true;
}

function readPage(page: HTMLTableElement): PageLayout {
  const cell = pageCell(page);
  const column = cell ? columnOf(cell) : null;
  const width = column ? parseFloat(column.style.maxWidth) : NaN;
  return normalizePageLayout({
    kind: 'centered',
    width: Number.isFinite(width) ? width : PAGE_WIDTH,
    background: cell ? fillOf(cell) : null,
    columnBackground: column ? fillOf(column) : null,
    spacing: cell ? parseFloat(cell.style.paddingTop) || 0 : 0,
  })!;
}

function pageCell(page: HTMLTableElement): HTMLTableCellElement | null {
  return page.rows?.[0]?.cells[0] ?? null;
}

function columnOf(cell: Element): HTMLElement | null {
  const column = Array.from(cell.children).find((child) => markedAs(child) === 'page-column');
  return (column as HTMLElement | undefined) ?? null;
}

/** A fill as its element declares it: the style's, else `bgcolor`. */
function fillOf(el: HTMLElement): string | null {
  return color(el.style.backgroundColor || el.getAttribute('bgcolor') || '');
}

/** The page's content in its place: the runs' blocks and the sections
    (their inner width back to a section's own), the column and the ghost
    comments gone. */
function unwrapPage(page: HTMLTableElement): void {
  const cell = pageCell(page);
  const column = cell ? columnOf(cell) : null;
  if (!column) {
    const rest = cell ? Array.from(cell.childNodes).filter((node) => node.nodeType !== 8) : [];
    page.replaceWith(...rest);
    return;
  }
  const nodes: ChildNode[] = [];
  for (const child of Array.from(column.childNodes)) {
    if (child instanceof HTMLElement && markedAs(child) === 'page-run') {
      nodes.push(...Array.from(child.childNodes));
    } else {
      if (child instanceof HTMLElement && markedAs(child) === 'section') {
        setSectionWidth(child, SECTION_CONTENT_MAX);
      }
      nodes.push(child);
    }
  }
  page.replaceWith(...nodes);
}

/** The cell of the page round a serialized body — what holds the page's
    colour (`emailDocument` paints the `<body>` with it) — or null for a body
    with no page of its own. */
export function pageCellOf(body: ParentNode): HTMLTableCellElement | null {
  const page = Array.from(body.querySelectorAll('table')).find(
    (table) => markedAs(table) === 'page' && outermost(table, body),
  );
  return page ? pageCell(page) : null;
}

/** The page's colour, as its cell declares it — null for none. */
export function pageFillOf(cell: HTMLElement): string | null {
  return fillOf(cell);
}
