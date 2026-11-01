import { emailBackgroundPalette, fillTextColor } from './dual-contrast';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { SECTION_CONTENT_MAX, SECTION_INSET } from './extensions/nodes/section';
import { layoutMarker, markedAs, unmark } from './layout-marker';
import { parseDeclarations } from './inline-style';

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
export type PageLayout = CenteredPageLayout | TablePageLayout | StylesheetPageLayout;

/** The kinds a page layout comes in. */
export const PAGE_LAYOUT_KINDS = ['centered', 'table', 'stylesheet'] as const;
export type PageLayoutKind = (typeof PAGE_LAYOUT_KINDS)[number];

export interface CenteredPageLayout extends PageFrame {
  readonly kind: 'centered';
  /** The column's room round its runs of blocks (the text between bands),
      px — 0 to {@link PAGE_INSET_MAX}, in 4px steps; {@link PAGE_COLUMN_INSET}
      by default. 0 where the blocks bring their own (a converted MJML page:
      every band its own padding). */
  readonly inset: number;
}

/**
 * The second kind, `table`, is the hand-coded email's page: the same page
 * and column, but the column a table and the email its rows — every line
 * of the body in a row (`pageRow`, a hidden layout element with a fill, a
 * text colour and a padding of its own), nothing between them. Where
 * `centered` is a free column with bands standing in it, here there is no
 * column outside a row: a new line stays in its row and its colour.
 *
 * **Both ways.** The kinds turn into each other ({@link createPageLayout},
 * in the step that changes the kind): into rows, each band becomes a
 * coloured row and each run of blocks between them a plain row; out of
 * rows, a coloured row becomes a band and a plain row gives its blocks back
 * to the column. All that is lost is where two plain rows met.
 *
 * **Emit:** the `centered` page, its column a table (`aee-layout-page-column`
 * on a `<table>`, capped by `max-width`, Outlook's ghost table round it as
 * for the div) — a `<td>` per row, marked `aee-layout-page-row`, its fill as
 * `bgcolor` too.
 *
 * **Parse:** the marked form lifts as `centered`'s does, each cell back to
 * its row. The unmarked form — a 100% table holding one fixed-width table
 * of one-cell rows, a fill on either — is recognised as one
 * ({@link liftPageLayout}): each row becomes a row of ours with the cell's
 * fill and padding, its text styles on a block round its words. What it
 * sends is the marked form.
 */
export interface TablePageLayout extends PageFrame {
  readonly kind: 'table';
  /** The room round a row's blocks, px, for every row that says none of its
      own — 0 to {@link PAGE_ROW_PADDING_MAX}, in 4px steps; the column
      table's `cellpadding` in the email, which every client (Outlook too)
      gives each cell without a padding of its own. */
  readonly rowPadding: number;
}

/**
 * The third kind, `stylesheet`, is the centred page drawn by the head: the
 * body carries class names only, every value lives in one rule in the
 * document's `<head>` — the column's cap and room, the runs' inset, and what
 * a phone gets instead (`@media`), which no inline style can say. Learned
 * from Notion's mail (a centred cell, a classed div, the head's rule).
 *
 * **Head only.** Where a client drops the head (Gmail's app with another
 * provider's account, some webmail) the column runs the window's width with
 * no inset; Outlook on Windows ignores the cap as it does any `max-width`,
 * and no ghost table stands in for it. Chosen knowingly (the user's call,
 * 2026-11-01) for HTML the author can read.
 *
 * **Emit:** the page table (`bgcolor` its one value: an attribute, not a
 * style) → a centred cell → the column div (`aee-layout-page-column`) and
 * its runs (`aee-layout-page-run`), unstyled; the rule in
 * `<style class="aee-layout-page-sheet">` ({@link pageLayoutSheet}) — in
 * the envelope's head, or first in a body without one (`emailDocument`
 * moves it to the head it sends). A band takes part: its inner column, when
 * it is the default one (the page's cap, a section's inset), sheds its
 * inline style for the run's class — text in a band and between bands
 * share one inset, on a phone too.
 *
 * **Parse:** a page whose column is a div with no inline cap is this kind;
 * its values come back from our own rule (the defaults where a client
 * stripped it), the rule comes off the head before the envelope is read,
 * and every band gets its inline inner style back.
 *
 * **New ours, theirs carried.** A new page says what we say: no spacing in
 * the page table, a phone as the window's width ({@link PAGE_PHONE_MEDIA}).
 * A page that came with the author's HTML (authored-page.ts) carries what
 * theirs said — a table leaving the browser its default cell spacing, a
 * phone as the device's width — so it lays out as it did.
 */
export interface StylesheetPageLayout extends PageFrame {
  readonly kind: 'stylesheet';
  /** The runs' room left and right, px — 0 to {@link PAGE_INSET_MAX}, in 4px
      steps; {@link PAGE_SHEET_INSET} by default. */
  readonly inset: number;
  /** The runs' room left and right on a phone, px — the same bounds;
      {@link PAGE_PHONE_INSET} by default. */
  readonly phoneInset: number;
  /** The room above and below the column on a phone, px — 0 to
      {@link PAGE_SPACING_MAX}; none by default. */
  readonly phoneSpacing: number;
  /** When the head rule's phone values apply: an `@media` condition —
      {@link PAGE_PHONE_MEDIA} by default, an author's own carried. */
  readonly phoneMedia: string;
  /** The page table's `cellspacing` and `cellpadding`, px — 0 by default;
      null where the page leaves the browser its own (an author's table that
      said none). */
  readonly cellSpacing: number | null;
  readonly cellPadding: number | null;
}

/** An `@media` condition we write back as it came: words, numbers, colons,
    brackets and commas — no brace, no quote, nothing that ends a rule. */
const MEDIA_CONDITION = /^[a-z0-9\s:().,-]{1,200}$/i;

/** A new Stylesheet page's room round its runs. */
export const PAGE_SHEET_INSET = 32;

/** A new Stylesheet page's room round its runs on a phone: a section's. */
export const PAGE_PHONE_INSET = SECTION_INSET;

/** The widest screen the head rule treats as a phone — Dawn's `STACK_RULE`
    breakpoint, so a page and its stacking columns turn together. */
export const PAGE_PHONE_MAX = 479;

/** A phone, as a new Stylesheet page's rule asks: the window up to
    {@link PAGE_PHONE_MAX}px. */
export const PAGE_PHONE_MEDIA = `only screen and (max-width:${PAGE_PHONE_MAX}px)`;

/** The most cell spacing or padding a Stylesheet page's table carries. */
const PAGE_CELL_MAX = 32;

/** A new page of rows' room round its rows' blocks: the column's inset, so
    the text in a row stands where a free column's does. */
export const PAGE_ROW_PADDING = 16;

/** The most room round a row's blocks. */
export const PAGE_ROW_PADDING_MAX = 64;

/** What every kind of page says: the column's measure, the two colours
    and the room round the column. */
export interface PageFrame {
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

/** The most room round a centred column's runs. */
export const PAGE_INSET_MAX = 64;

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
  })! as CenteredPageLayout;
}

/** A page of rows (the `table` kind) — the centred page's defaults and
    {@link PAGE_ROW_PADDING} round each row's blocks, with any of it
    overridden. */
export function tablePageLayout(
  layout: Partial<Omit<TablePageLayout, 'kind'>> = {},
): TablePageLayout {
  return normalizePageLayout({
    ...centeredPageLayout(),
    rowPadding: PAGE_ROW_PADDING,
    ...layout,
    kind: 'table',
  })! as TablePageLayout;
}

/** A Stylesheet page — the centred page's defaults, {@link PAGE_SHEET_INSET}
    round its runs and {@link PAGE_PHONE_INSET} on a phone, with no room
    above and below there — with any of it overridden. */
export function stylesheetPageLayout(
  layout: Partial<Omit<StylesheetPageLayout, 'kind'>> = {},
): StylesheetPageLayout {
  return normalizePageLayout({
    ...centeredPageLayout(),
    inset: PAGE_SHEET_INSET,
    phoneInset: PAGE_PHONE_INSET,
    phoneSpacing: 0,
    phoneMedia: PAGE_PHONE_MEDIA,
    cellSpacing: 0,
    cellPadding: 0,
    ...layout,
    kind: 'stylesheet',
  })! as StylesheetPageLayout;
}

/** A layout as the document may hold it — or null for anything that is not
    one. The width and the room snap to their 4px grid within their bounds
    (no room said is none); a colour that is not a safe one is dropped. */
export function normalizePageLayout(value: unknown): PageLayout | null {
  if (!value || typeof value !== 'object') return null;
  const layout = value as Record<string, unknown>;
  const kind = layout['kind'] as PageLayoutKind;
  if (!PAGE_LAYOUT_KINDS.includes(kind)) return null;
  const raw = Number(layout['width']);
  const width = Number.isFinite(raw)
    ? Math.min(PAGE_WIDTH_MAX, Math.max(PAGE_WIDTH_MIN, Math.round(raw / 4) * 4))
    : PAGE_WIDTH;
  const spacing = step(layout['spacing'], PAGE_SPACING_MAX);
  const frame = {
    width,
    background: color(layout['background']),
    columnBackground: color(layout['columnBackground']),
    spacing,
  };
  if (kind === 'table') {
    return { kind, ...frame, rowPadding: step(layout['rowPadding'], PAGE_ROW_PADDING_MAX) };
  }
  const room = (name: string, fallback: number, max: number) =>
    layout[name] === undefined || layout[name] === null ? fallback : step(layout[name], max);
  if (kind === 'stylesheet') {
    // A table's spacing as it was said: whole px, or null for the
    // browser's own; none said at all is ours, 0.
    const cell = (name: string) => {
      if (layout[name] === null) return null;
      const n = Math.round(Number(layout[name] ?? 0));
      return Number.isFinite(n) ? Math.min(PAGE_CELL_MAX, Math.max(0, n)) : 0;
    };
    const media = typeof layout['phoneMedia'] === 'string' ? layout['phoneMedia'].trim() : '';
    return {
      kind,
      ...frame,
      inset: room('inset', PAGE_SHEET_INSET, PAGE_INSET_MAX),
      phoneInset: room('phoneInset', PAGE_PHONE_INSET, PAGE_INSET_MAX),
      phoneSpacing: step(layout['phoneSpacing'], PAGE_SPACING_MAX),
      phoneMedia: MEDIA_CONDITION.test(media) ? media : PAGE_PHONE_MEDIA,
      cellSpacing: cell('cellSpacing'),
      cellPadding: cell('cellPadding'),
    };
  }
  return { kind, ...frame, inset: room('inset', PAGE_COLUMN_INSET, PAGE_INSET_MAX) };
}

/** A length on the 4px grid, 0 to `max` — none said is 0. */
function step(value: unknown, max: number): number {
  const raw = Number(value);
  return Number.isFinite(raw) ? Math.min(max, Math.max(0, Math.round(raw / 4) * 4)) : 0;
}

/** Whether two layouts are the same — null included. */
export function samePageLayout(a: PageLayout | null, b: PageLayout | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.width === b.width &&
    a.background === b.background &&
    a.columnBackground === b.columnBackground &&
    a.spacing === b.spacing &&
    (a.kind !== 'table' || a.rowPadding === (b as TablePageLayout).rowPadding) &&
    (a.kind === 'table' || a.inset === (b as CenteredPageLayout).inset) &&
    (a.kind !== 'stylesheet' ||
      (a.phoneInset === (b as StylesheetPageLayout).phoneInset &&
        a.phoneSpacing === (b as StylesheetPageLayout).phoneSpacing &&
        a.phoneMedia === (b as StylesheetPageLayout).phoneMedia &&
        a.cellSpacing === (b as StylesheetPageLayout).cellSpacing &&
        a.cellPadding === (b as StylesheetPageLayout).cellPadding))
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
 * column's inset, and the sections at the layout's width — the column a
 * div (`centered`) or a table of rows (`table`).
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
  const cell = table.createTBody().insertRow().insertCell();
  if (layout.kind === 'stylesheet') {
    // Drawn by the head's rule: nothing inline but the page's colour, an
    // attribute on the table — round its cell's spacing too, as an author's
    // page table carries it — and the cell centres the column for a client
    // that drops the rule's auto margins.
    cell.setAttribute('align', 'center');
    if (layout.background) table.setAttribute('bgcolor', layout.background);
    // The table's spacing as the page says it — none said, the browser's.
    for (const [name, value] of [
      ['cellpadding', layout.cellPadding],
      ['cellspacing', layout.cellSpacing],
    ] as const) {
      if (value === null) table.removeAttribute(name);
      else table.setAttribute(name, String(value));
    }
    cell.append(sheetColumn(doc, container));
    container.replaceChildren(table);
    return;
  }
  table.style.cssText = 'width: 100%; border-collapse: collapse;';
  // The room above and below the column: the page cell's padding — the one
  // padding Outlook's Word engine honours, on a cell.
  const room = layout.spacing ? `padding: ${layout.spacing}px 0px;` : '';
  if (layout.background) cell.setAttribute('bgcolor', layout.background);
  const style = [room, layout.background ? fillStyle(layout.background) : '']
    .filter(Boolean)
    .join(' ');
  if (style) cell.style.cssText = style;
  const column =
    layout.kind === 'table'
      ? rowsColumn(doc, container, layout)
      : freeColumn(doc, container, layout);
  cell.append(doc.createComment(ghostOpen(layout)), column, doc.createComment(GHOST_CLOSE));
  container.replaceChildren(table);
}

/** The `centered` column: a capped div, the runs of blocks and the
    sections in it. */
function freeColumn(doc: Document, container: HTMLElement, layout: PageLayout): HTMLElement {
  const column = doc.createElement('div');
  column.className = layoutMarker('page-column');
  column.style.cssText =
    `max-width: ${layout.width}px; margin: 0 auto;` +
    (layout.columnBackground ? ` ${fillStyle(layout.columnBackground)}` : '');

  let run: ChildNode[] = [];
  const inset = layout.kind === 'centered' ? layout.inset : PAGE_COLUMN_INSET;
  const flush = () => {
    if (run.length) column.append(runOf(doc, run, inset));
    run = [];
  };
  for (const child of Array.from(container.childNodes)) {
    if (child instanceof HTMLElement && isStrip(child)) {
      // A strip (a filled spacer) stands in the column as a band does,
      // edge to edge — never inset in a run.
      flush();
      column.append(child);
    } else if (child instanceof HTMLElement && markedAs(child) === 'section') {
      flush();
      // The default band takes the page's width; one with a width of its
      // own (or none, `full`) keeps it.
      recapSection(child, SECTION_CONTENT_MAX, layout.width);
      column.append(child);
    } else {
      run.push(child);
    }
  }
  flush();
  return column;
}

/** The `stylesheet` column: a div with nothing inline — the head's rule
    draws it ({@link pageLayoutSheet}) — the runs of blocks and the bands in
    it, a default band's inner column on the runs' class. */
function sheetColumn(doc: Document, container: HTMLElement): HTMLElement {
  const column = doc.createElement('div');
  column.className = layoutMarker('page-column');
  let run: ChildNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const div = doc.createElement('div');
    div.className = layoutMarker('page-run');
    div.append(...run);
    column.append(div);
    run = [];
  };
  for (const child of Array.from(container.childNodes)) {
    if (child instanceof HTMLElement && (isStrip(child) || markedAs(child) === 'section')) {
      flush();
      if (markedAs(child) === 'section') bandOnRun(child);
      column.append(child);
    } else {
      run.push(child);
    }
  }
  flush();
  return column;
}

/** A default band's inner column as the email writes it: a section's cap
    and inset, centred (section.ts `innerStyle`). */
const BAND_INNER =
  `max-width: ${SECTION_CONTENT_MAX}px; margin-left: auto; margin-right: auto; ` +
  `padding-left: ${SECTION_INSET}px; padding-right: ${SECTION_INSET}px; box-sizing: border-box;`;

/** A default band in a Stylesheet page: its inner column's inline style
    traded for the runs' class — the column caps it, the rule insets it.
    A band with a width, a card or an inset of its own keeps its style. */
function bandOnRun(section: HTMLElement): void {
  const inner = sectionInner(section);
  if (!inner || inner.getAttribute('style') !== BAND_INNER || inner.hasAttribute('class')) return;
  inner.removeAttribute('style');
  inner.className = layoutMarker('page-run');
}

/** A band's inner column back from the runs' class to its inline style —
    what the section node claims (section.ts `sectionContent`). */
function bandOffRun(section: HTMLElement): void {
  const inner = sectionInner(section);
  if (!inner || markedAs(inner) !== 'page-run') return;
  unmark(inner);
  inner.setAttribute('style', BAND_INNER);
}

/**
 * The head's rule a Stylesheet page is drawn by: the column's cap, its
 * room above and below and its colour, the runs' inset — and on a phone
 * (≤ {@link PAGE_PHONE_MAX}px) the room and the inset a phone gets. Every
 * value the page has, in one place; the body only names it.
 */
export function pageLayoutSheet(layout: StylesheetPageLayout): string {
  const column = `.${layoutMarker('page-column')}`;
  const run = `.${layoutMarker('page-run')}`;
  const ink = layout.columnBackground ?? layout.background;
  const paint =
    (layout.columnBackground ? `background-color:${layout.columnBackground};` : '') +
    (ink ? `color:${fillTextColor(ink)};` : '');
  const inset = (px: number) => `{padding-left:${px}px;padding-right:${px}px}`;
  return (
    `${column}{max-width:${layout.width}px;margin:${layout.spacing}px auto;${paint}}` +
    `${run}${inset(layout.inset)}` +
    `@media ${layout.phoneMedia}{` +
    `${column}{margin:${layout.phoneSpacing}px auto}${run}${inset(layout.phoneInset)}}`
  );
}

/** {@link pageLayoutSheet} in its `<style>`, marked as ours. */
export function pageLayoutSheetElement(layout: StylesheetPageLayout): string {
  return `<style class="${layoutMarker('page-sheet')}">${pageLayoutSheet(layout)}</style>`;
}

/** A strip: a spacer of ours with a fill. */
function isStrip(el: HTMLElement): boolean {
  return markedAs(el) === 'spacer' && /background-color\s*:/i.test(el.getAttribute('style') ?? '');
}

/** The `table` column: a capped table, a `<td>` per row (the row's own
    marker and style, its fill as `bgcolor` too) and a padded one for any
    blocks between (a body the editor did not keep in rows). */
function rowsColumn(doc: Document, container: HTMLElement, layout: PageLayout): HTMLElement {
  const column = doc.createElement('table');
  column.className = layoutMarker('page-column');
  setAttributes(column, {
    role: 'presentation',
    align: 'center',
    width: '100%',
    // The page's room round a row's blocks, for every row with none of its
    // own (a cell's padding wins over it, in every client).
    cellpadding: String(layout.kind === 'table' ? layout.rowPadding : 0),
    cellspacing: '0',
    border: '0',
  });
  column.style.cssText =
    `max-width: ${layout.width}px; margin: 0 auto; width: 100%; border-collapse: collapse;` +
    (layout.columnBackground ? ` ${fillStyle(layout.columnBackground)}` : '');
  const rows = column.createTBody();

  let run: ChildNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const cell = rows.insertRow().insertCell();
    cell.className = layoutMarker('page-run');
    cell.style.cssText = `padding: ${PAGE_COLUMN_INSET}px;`;
    cell.append(...run);
    run = [];
  };
  for (const child of Array.from(container.childNodes)) {
    if (!(child instanceof HTMLElement && markedAs(child) === 'page-row')) {
      run.push(child);
      continue;
    }
    flush();
    // The marker first, then the fill for Outlook, then the row's style —
    // the order a browser and jsdom print alike (layout-marker.ts).
    const cell = rows.insertRow().insertCell();
    cell.className = child.className;
    const fill = color(child.style.backgroundColor);
    if (fill) cell.setAttribute('bgcolor', fill);
    // A plain row with the page's padding says nothing: no style at all.
    const style = child.getAttribute('style');
    if (style) cell.setAttribute('style', style);
    cell.append(...Array.from(child.childNodes));
  }
  flush();
  return column;
}

/** The blocks between two sections, with the column's inset round them. */
function runOf(doc: Document, nodes: ChildNode[], inset: number): HTMLElement {
  const run = doc.createElement('div');
  run.className = layoutMarker('page-run');
  run.style.cssText = `padding: ${inset}px;`;
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

/** A section's inner column (its cell's one div, the VML comments round it
    aside) capped at `to` where it was capped at `from` — the default band's
    width and the page's, one way or back — on the attribute's own words, so
    the rest of the style reads back exactly as the section wrote it (a
    CSSOM write would respell it). Any other cap, or none, is the band's own. */
function recapSection(section: HTMLElement, from: number, to: number): void {
  const inner = sectionInner(section);
  const style = inner?.getAttribute('style');
  if (!inner || !style) return;
  const cap = new RegExp(`max-width:\\s*${from}px`, 'i');
  inner.setAttribute('style', style.replace(cap, `max-width: ${to}px`));
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
 *
 * A body with no marked page is read as it stands: a page of rows written
 * by hand (unmarked) is kept as authored and offered as a page of ours by
 * the page grip (authored-page.ts), never lifted on parse.
 *
 * A marked page edited by hand may hold more than the one cell we send —
 * rows of ours copied straight into the page table, beside the column
 * ({@link strayCells}). That is no page of ours: those rows were never in
 * the column, and a client draws them as wide as the room. No layout is
 * taken, and nothing is repaired: it keeps its markup, as authored, and
 * loses our markers ({@link unmarkPage}) — nothing dropped. Turning it
 * into bands is the author's call, never the parse's.
 */
export function liftPageLayout(root: Element, head: Element | null = null): PageLayout | null {
  const pages = Array.from(root.querySelectorAll('table')).filter(
    (table) => markedAs(table) === 'page',
  );
  if (!pages.length) return null;
  let layout: PageLayout | null = null;
  for (const page of pages) {
    if (strayCells(page).length) {
      unmarkPage(page);
      continue;
    }
    if (!layout && outermost(page, root)) {
      layout = readPage(page);
      // A Stylesheet page's values are its head rule's — which comes off
      // with it, before the envelope is read (`head`).
      if (layout.kind === 'stylesheet') layout = readSheet(layout, takeSheet(root, head), page);
    }
    unwrapPage(page);
  }
  return layout;
}

/** Our page's head rule taken out — from the head, or the body's top level
    (a body with no envelope carries it there) — its text, or '' where a
    client dropped it. */
function takeSheet(root: Element, head: Element | null): string {
  const sheets = [...Array.from(head?.children ?? []), ...Array.from(root.children)].filter(
    (el) => el.tagName === 'STYLE' && markedAs(el) === 'page-sheet',
  );
  sheets.forEach((sheet) => sheet.remove());
  return sheets[0]?.textContent ?? '';
}

/** A Stylesheet page as its rule says it ({@link pageLayoutSheet}, read
    back); what the rule does not say — all of it, where it was dropped —
    the kind's defaults. The page's colour is the cell's attribute. */
function readSheet(page: PageLayout, css: string, table: HTMLTableElement): PageLayout {
  const at = css.search(/@media/i);
  const media = /@media\s*([^{]*)\{/i.exec(css)?.[1].trim();
  // The table's spacing: what it says, or null where it leaves the browser
  // its own.
  const spacingOf = (name: string) => {
    const value = table.getAttribute(name);
    return value === null ? null : parseFloat(value) || 0;
  };
  const [desk, phone] = at < 0 ? [css, ''] : [css.slice(0, at), css.slice(at)];
  const rule = (part: string, kind: 'page-column' | 'page-run') => {
    const found = new RegExp(`\\.(?:x_|m_-?\\d+)?${layoutMarker(kind)}\\s*\\{([^}]*)\\}`).exec(
      part,
    );
    return new Map(
      parseDeclarations(found?.[1] ?? '').map((d) => [d.name.toLowerCase(), d.value] as const),
    );
  };
  const px = (value: string | undefined) => {
    const n = parseFloat(value ?? '');
    return Number.isFinite(n) ? n : undefined;
  };
  const column = rule(desk, 'page-column');
  const said = {
    width: px(column.get('max-width')),
    spacing: px(column.get('margin')),
    inset: px(rule(desk, 'page-run').get('padding-left')),
    phoneInset: px(rule(phone, 'page-run').get('padding-left')),
    phoneSpacing: px(rule(phone, 'page-column').get('margin')),
  };
  return stylesheetPageLayout({
    ...Object.fromEntries(Object.entries(said).filter(([, value]) => value !== undefined)),
    ...(media ? { phoneMedia: media } : {}),
    background: page.background,
    columnBackground: color(column.get('background-color') ?? ''),
    cellSpacing: spacingOf('cellspacing'),
    cellPadding: spacingOf('cellpadding'),
  });
}

/** A table's `cellpadding`, px — 0 where it says none (a hand-coded email
    writes `0`; a browser's own default, 1px, is no room anyone asked for). */
export function cellPadding(table: HTMLTableElement): number {
  return parseFloat(table.getAttribute('cellpadding') ?? '') || 0;
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
    // A column of rows is a table; the free column, a div — capped inline,
    // or by the head's rule (a Stylesheet page).
    kind:
      column instanceof HTMLTableElement
        ? 'table'
        : column && !column.style.maxWidth
          ? 'stylesheet'
          : 'centered',
    width: Number.isFinite(width) ? width : PAGE_WIDTH,
    // The cell's colour — a Stylesheet page's on its table.
    background: cell ? (fillOf(cell) ?? fillOf(page)) : null,
    columnBackground: column ? fillOf(column) : null,
    spacing: cell ? parseFloat(cell.style.paddingTop) || 0 : 0,
    rowPadding: column instanceof HTMLTableElement ? cellPadding(column) : 0,
    inset: column && !(column instanceof HTMLTableElement) ? runInset(column) : undefined,
  })!;
}

/** The inset a free column's runs carry — the first run's padding; the
    default where there is no run (bands alone). */
function runInset(column: HTMLElement): number | undefined {
  const run = Array.from(column.children).find((child) => markedAs(child) === 'page-run');
  if (!(run instanceof HTMLElement)) return undefined;
  const padding = parseFloat(run.style.paddingTop);
  return Number.isFinite(padding) ? padding : undefined;
}

function pageCell(page: HTMLTableElement): HTMLTableCellElement | null {
  return page.rows?.[0]?.cells[0] ?? null;
}

/** The page table's cells past its own — none in what we send; a hand edit's
    rows beside the column (a row of ours pasted into the page table). */
function strayCells(page: HTMLTableElement): HTMLTableCellElement[] {
  return Array.from(page.rows ?? [])
    .flatMap((row) => Array.from(row.cells))
    .slice(1);
}

/** A page that is no page of ours, as authored markup: our page markers off
    it — the page's, its column's and runs', its stray rows' — so nothing
    reads it (or paints the body with its fill) as ours. */
function unmarkPage(page: HTMLTableElement): void {
  const cell = pageCell(page);
  const column = cell ? columnOf(cell) : null;
  const runs = column ? Array.from(column.children) : [];
  for (const el of [page, column, ...runs, ...strayCells(page)]) {
    if (el && el instanceof HTMLElement && markedAs(el) === 'section') bandOffRun(el);
    else if (el && markedAs(el)?.startsWith('page')) unmark(el);
  }
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
  if (column instanceof HTMLTableElement) {
    page.replaceWith(...rowsOf(column));
    return;
  }
  const width = parseFloat(column.style.maxWidth);
  const nodes: ChildNode[] = [];
  for (const child of Array.from(column.childNodes)) {
    if (child instanceof HTMLElement && markedAs(child) === 'page-run') {
      nodes.push(...Array.from(child.childNodes));
    } else {
      if (child instanceof HTMLElement && markedAs(child) === 'section') {
        // A centred page recapped the band; a Stylesheet page put its inner
        // column on the runs' class.
        if (width) recapSection(child, width, SECTION_CONTENT_MAX);
        bandOffRun(child);
      }
      nodes.push(child);
    }
  }
  page.replaceWith(...nodes);
}

/** A column of rows' content in its place: each row's cell back to the
    row's own `div` (its marker and style; the `bgcolor` was Outlook's),
    each padded cell's blocks as they stood. */
function rowsOf(column: HTMLTableElement): ChildNode[] {
  const nodes: ChildNode[] = [];
  for (const tr of Array.from(column.rows)) {
    const cell = tr.cells[0];
    if (!cell) continue;
    if (markedAs(cell) !== 'page-row') {
      nodes.push(...Array.from(cell.childNodes));
      continue;
    }
    const row = column.ownerDocument.createElement('div');
    row.setAttribute('class', cell.getAttribute('class') ?? '');
    const style = cell.getAttribute('style');
    if (style) row.setAttribute('style', style);
    row.append(...Array.from(cell.childNodes));
    nodes.push(row);
  }
  return nodes;
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
  const table = cell.closest('table');
  return fillOf(cell) ?? (table ? fillOf(table) : null);
}
