import { Node, Schema } from 'prosemirror-model';
import { Command } from 'prosemirror-state';
import { convertBands } from './authored-band';
import { isFillTextColor } from './dual-contrast';
import { isSafeColor, toEmailSafeColor } from './extensions/marks/text-style';
import { pageRowStyle } from './extensions/nodes/page-row';
import { bandTable } from './extensions/nodes/section';
import { spacerStyle } from './extensions/nodes/spacer';
import { parsePadding } from './extensions/nodes/table';
import { declarationProperty, splitDeclarations } from './email-vocabulary';
import { parseHTML, serializeToHTML } from './html';
import { inlinePadding, paddingOf, paddingSides, parseDeclarations } from './inline-style';
import { AttributePairs } from './verbatim';
import { layoutMarker, markedAs } from './layout-marker';
import { DocumentEnvelope, canonicalHead } from './envelope';
import {
  PAGE_INSET_MAX,
  PAGE_WIDTH,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  PageLayout,
  cellPadding,
  centeredPageLayout,
  stylesheetPageLayout,
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
 *
 * A third, a centred column written band by band — MJML's way: a wrapper
 * (the body's `<div>`) holding nothing but bands, each its own `max-width`
 * of one width with auto side margins, on the wrapper's page colour. It is
 * the `centered` page kind, every band centring itself; offered as one
 * ({@link convertAuthoredPageToCentred}) — the same look, the page's width
 * and colours then the author's to set.
 *
 * A fourth, a page drawn by its head — Notion's way: a 100% table, one
 * cell, one classed `div` the head's rule caps and insets (a phone's inset
 * in an `@media` rule). It is the `stylesheet` page kind as an author wrote
 * it; offered as one ({@link convertAuthoredPageToStylesheet}) — their
 * wrapper and type kept, only the layout's values moving to the layout.
 * Read with the document's head, so the host passes the document.
 */

/** What an authored page would be in our blocks: the markup, in order, and
    what it holds — so a host can say what a conversion makes ("to spacer",
    "to sections", both). */
export interface AuthoredPageConversion {
  /** Which pattern: a page of ours with rows pasted beside its column, a
      page of rows written by hand, or a centred column written band by
      band. */
  shape: 'stray-rows' | 'rows-page' | 'centred-bands' | 'stylesheet-page';
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
      why it is the author's choice ({@link convertAuthoredPageToRows}).
      Null for a centred column. */
  rows: { html: string; layout: PageLayout } | null;
  /** The centred page its bands stand for: their width, the wrapper's
      colour, no room of the page's own — the same pixels
      ({@link convertAuthoredPageToCentred}). Null for the other patterns. */
  centred: { layout: PageLayout; bands: number } | null;
  /** The Stylesheet page a page drawn by its head stands for: the layout
      its wrapper's rule says, the wrapper (its class `wrapper`) kept as the
      body's one block, and the head with the rule's layout declarations
      taken out — the layout says them now
      ({@link convertAuthoredPageToStylesheet}). Null for the other
      patterns. */
  stylesheet: { layout: PageLayout; wrapper: string; head: string } | null;
}

/** Recognised tables, by node — and the head they were read against: a
    decoration asks on every state. */
const seen = new WeakMap<Node, { head: string; result: AuthoredPageConversion | null }>();

/** What the authored table at the top level would be in our blocks — the
    strip and the bands, in order — or null for anything that is not the
    pattern. `doc`, the document it stands in, lends its head: a page drawn
    by its head rule is recognised only with it. */
export function authoredPageBands(
  node: Node,
  schema: Schema,
  doc?: Node,
): AuthoredPageConversion | null {
  const head = (doc?.attrs['envelope'] as DocumentEnvelope | null | undefined)?.head ?? '';
  const known = seen.get(node);
  if (known && known.head === head) return known.result;
  const result = recognise(node, schema, head);
  seen.set(node, { head, result });
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
    if (!node || !conversion?.rows || state.doc.attrs['pageLayout']) return false;
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

/** Turns the centred column written band by band at `pos` into a centred
    page of ours (`centred` of {@link authoredPageBands}): the document's
    page layout set to the bands' width on the wrapper's colour, and each
    band's own centring taken off — the page's column centres them now, so
    they follow its width. Everything else stays as written — unless
    `bands` asks for MJML's bands as sections too (`convertBands`,
    authored-band.ts), in the same step. One step, undone as one. False
    where the node is not the pattern, the document has a page layout
    already, or anything stands beside it. */
export function convertAuthoredPageToCentred(
  pos: number,
  { bands = false }: { bands?: boolean } = {},
): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const conversion = node ? authoredPageBands(node, state.schema) : null;
    if (!node || !conversion?.centred || state.doc.attrs['pageLayout']) return false;
    if (state.doc.childCount !== 1) return false;
    if (dispatch) {
      const tr = state.tr;
      node.forEach((band, offset) => {
        if (band.type.name !== 'htmlElement' || band.attrs['tag'] !== 'div') return;
        const attrs = (band.attrs['attrs'] as AttributePairs)
          .map(([name, value]): [string, string] => [
            name,
            name === 'style' ? uncentred(value) : value,
          ])
          .filter(([name, value]) => name !== 'style' || value.trim());
        tr.setNodeMarkup(pos + 1 + offset, null, { ...band.attrs, attrs });
      });
      tr.setDocAttribute('pageLayout', conversion.centred.layout);
      if (bands) convertBands(tr);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** A band's style without its own centring — `max-width` and the auto side
    margins; a vertical margin it says stays. Every other declaration keeps
    its text. */
function uncentred(style: string): string {
  return splitDeclarations(style)
    .map((part) => {
      const property = declarationProperty(part);
      if (property === 'max-width' || property === 'margin-left' || property === 'margin-right') {
        return null;
      }
      if (property !== 'margin') return part;
      const sides = part
        .slice(part.indexOf(':') + 1)
        .trim()
        .split(/\s+/);
      const top = sides[0] ?? '0';
      const bottom = sides[2] ?? top;
      const zero = (side: string) => /^0(?:px)?$/.test(side);
      return zero(top) && zero(bottom) ? null : `margin:${top} 0px ${bottom}`;
    })
    .filter((part): part is string => part !== null)
    .join(';');
}

/** Turns the page drawn by its head at `pos` into a Stylesheet page of ours
    (`stylesheet` of {@link authoredPageBands}): the author's wrapper —
    their class, their type — the body's one block, their outer table gone;
    the rule's cap, side room and colour (and a phone's side room) moved
    from their rule into the layout, everything else in the head as it was.
    One step, undone as one. False where the node is not the pattern, the
    document has a page layout already, or anything stands beside it. */
export function convertAuthoredPageToStylesheet(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const conversion = node ? authoredPageBands(node, state.schema, state.doc) : null;
    const envelope = state.doc.attrs['envelope'] as DocumentEnvelope | null | undefined;
    if (!node || !conversion?.stylesheet || !envelope || state.doc.attrs['pageLayout']) {
      return false;
    }
    if (state.doc.childCount !== 1) return false;
    const wrapper = wrapperNode(node, conversion.stylesheet.wrapper);
    if (!wrapper) return false;
    if (dispatch) {
      dispatch(
        state.tr
          .replaceWith(pos, pos + node.nodeSize, wrapper)
          .setDocAttribute('envelope', { ...envelope, head: conversion.stylesheet.head })
          .setDocAttribute('pageLayout', conversion.stylesheet.layout)
          .scrollIntoView(),
      );
    }
    return true;
  };
}

/** The kept `div` of class `name` inside an authored node — the very node,
    so the wrapper and all it holds stay exactly as parsed. */
function wrapperNode(node: Node, name: string): Node | null {
  let found: Node | null = null;
  node.descendants((child) => {
    if (found) return false;
    const attrs = child.attrs['attrs'] as AttributePairs | undefined;
    const classes = attrs?.find(([key]) => key === 'class')?.[1].split(/\s+/) ?? [];
    if (
      child.type.name === 'htmlElement' &&
      child.attrs['tag'] === 'div' &&
      classes.includes(name)
    ) {
      found = child;
    }
    return !found;
  });
  return found;
}

/** The declarations a wrapper's rule says that a Stylesheet page says now. */
const SHEET_LAYOUT_PROPERTIES = new Set([
  'max-width',
  'padding-left',
  'padding-right',
  'background-color',
]);

/**
 * A page drawn by its head — Notion's mail: a 100% table, its one cell, in
 * it one `div` whose class the head's rule caps (`max-width`) and insets
 * (equal side padding), maybe with a phone's side padding in an `@media`
 * rule. The Stylesheet page kind as an author wrote it. The cap is the
 * wrapper's content box unless it says `border-box`: the column is the cap
 * and both insets.
 */
function stylesheetPage(body: HTMLElement, head: string): AuthoredPageConversion | null {
  const table = soleChild(body);
  if (!(table instanceof HTMLTableElement)) return null;
  const tableWidth = (declared(table).get('width') ?? '').replace(/\s*!important$/i, '');
  if (table.getAttribute('width') !== '100%' && tableWidth !== '100%') return null;
  const rows = Array.from(table.rows);
  if (rows.length !== 1 || rows[0].cells.length !== 1) return null;
  const cell = rows[0].cells[0];
  const wrapper = soleChild(cell);
  if (!(wrapper instanceof HTMLDivElement)) return null;

  const sheets = headSheets(head);
  const rules = sheets.styles.flatMap((style, sheet) =>
    scanRules(style.textContent ?? '').map((rule) => ({ ...rule, sheet })),
  );
  for (const name of Array.from(wrapper.classList)) {
    const own = rules.filter((rule) => !rule.media && rule.selector === `.${name}`);
    const said = new Map(own.flatMap((rule) => Array.from(ruleDeclarations(rule.body))));
    const cap = cssPx(said.get('max-width'));
    if (cap === null) continue;
    const [, right, , left] = ruleSides(said);
    if (left !== right || left > PAGE_INSET_MAX) continue;
    const width = said.get('box-sizing') === 'border-box' ? cap : cap + left + right;
    if (width < PAGE_WIDTH_MIN || width > PAGE_WIDTH_MAX) continue;
    const phone = rules.filter((rule) => rule.media && rule.selector === `.${name}`);
    const phoneSaid = new Map(phone.flatMap((rule) => Array.from(ruleDeclarations(rule.body))));
    const phoneLeft = phoneSaid.size ? ruleSides(phoneSaid, left)[3] : left;
    const fill = said.get('background-color') ?? '';
    const ids = [table.id].filter(Boolean).map((id) => `#${id}`);

    // The head with the layout's declarations out of the wrapper's rules,
    // a rule left saying nothing gone, the outer table's own rules too.
    for (const [index, style] of sheets.styles.entries()) {
      const css = style.textContent ?? '';
      const edits = rules
        .filter((rule) => rule.sheet === index)
        .flatMap((rule) => {
          if (ids.includes(rule.selector)) return [{ rule, text: '' }];
          if (rule.selector !== `.${name}`) return [];
          const kept = withoutLayout(rule.body, Boolean(rule.media), fill);
          return [{ rule, text: kept ? `${css.slice(rule.start, rule.bodyStart)}${kept}}` : '' }];
        })
        .sort((a, b) => b.rule.start - a.rule.start);
      let next = css;
      for (const { rule, text } of edits)
        next = next.slice(0, rule.start) + text + next.slice(rule.end);
      if (edits.length) style.textContent = next.replace(/@media[^{}]*\{\s*\}/gi, '');
    }

    return {
      shape: 'stylesheet-page',
      html: null,
      spacers: 0,
      sections: 0,
      rows: null,
      centred: null,
      stylesheet: {
        wrapper: name,
        head: canonicalHead(sheets.dom.head),
        layout: stylesheetPageLayout({
          width,
          background: declaredFill(table) ?? declaredFill(cell),
          columnBackground: fill && isSafeColor(fill) ? toEmailSafeColor(fill) : null,
          // The room above and below stays the author's, on their wrapper.
          spacing: 0,
          inset: left,
          phoneInset: phoneLeft,
          phoneSpacing: 0,
          // Theirs carried: when their rule calls it a phone, and their
          // table's spacing — none said, the browser's.
          ...(phone[0]?.media ? { phoneMedia: phone[0].media } : {}),
          cellSpacing: tableSpacing(table, 'cellspacing'),
          cellPadding: tableSpacing(table, 'cellpadding'),
        }),
      },
    };
  }
  return null;
}

/** A table's `cellspacing` or `cellpadding`, px — null where it says none
    and leaves the browser its own. */
function tableSpacing(table: HTMLTableElement, name: string): number | null {
  const value = table.getAttribute(name);
  return value === null ? null : parseFloat(value) || 0;
}

/** A wrapper rule's body without what the layout says now — on a phone,
    only the side room — a padding shorthand kept as its top and bottom. */
function withoutLayout(body: string, phone: boolean, fill: string): string {
  return splitDeclarations(body)
    .flatMap((part) => {
      const property = declarationProperty(part);
      if (property === 'padding') {
        const [top, , bottom] = ruleSides(ruleDeclarations(part));
        return [top ? `padding-top:${top}px` : '', bottom ? `padding-bottom:${bottom}px` : ''];
      }
      if (property === 'padding-left' || property === 'padding-right') return [];
      if (!phone && property && SHEET_LAYOUT_PROPERTIES.has(property)) {
        return property === 'background-color' && !(fill && isSafeColor(fill)) ? [part] : [];
      }
      return [part];
    })
    .filter((part) => part.trim())
    .join(';');
}

/** The head's own document — its `<style>` elements, to read and to edit. */
function headSheets(head: string): { dom: Document; styles: HTMLStyleElement[] } {
  const dom = new DOMParser().parseFromString(
    `<!doctype html><html><head>${head}</head><body></body></html>`,
    'text/html',
  );
  return { dom, styles: Array.from(dom.head.querySelectorAll('style')) };
}

interface SheetRule {
  /** The selector as written, trimmed. */
  selector: string;
  /** What stands between its braces. */
  body: string;
  /** The `@media` condition it stands in, or null. */
  media: string | null;
  /** Where the rule starts and ends in its sheet's text, and where its body
      starts. */
  start: number;
  end: number;
  bodyStart: number;
}

/** The style rules of a sheet's text — top level and inside `@media`, the
    rest (`@font-face`, `@import`, …) passed over — read off the text, never
    the CSSOM (it respells). Comments count as space. */
function scanRules(text: string, media: string | null = null, offset = 0): SheetRule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
  const rules: SheetRule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open < 0) break;
    const close = closingBrace(css, open);
    if (close < 0) break;
    // An `@import …;` before a rule is no part of its selector.
    let from = at + css.slice(at, open).lastIndexOf(';') + 1;
    while (from < open && /\s/.test(css[from])) from++;
    const prelude = css.slice(from, open).trim();
    if (/^@media\b/i.test(prelude)) {
      rules.push(
        ...scanRules(text.slice(open + 1, close), prelude.slice(6).trim(), offset + open + 1),
      );
    } else if (prelude && !prelude.startsWith('@')) {
      rules.push({
        selector: prelude,
        body: css.slice(open + 1, close),
        media,
        start: offset + from,
        end: offset + close + 1,
        bodyStart: offset + open + 1,
      });
    }
    at = close + 1;
  }
  return rules;
}

/** The `}` that closes the block opened at `open`, quotes skipped — -1 for
    none. */
function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const char = css[i];
    if (char === '"' || char === "'") {
      const end = css.indexOf(char, i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i;
  }
  return -1;
}

/** A rule body's declarations, by property, `!important` aside. */
function ruleDeclarations(body: string): Map<string, string> {
  const said = new Map<string, string>();
  for (const part of splitDeclarations(body)) {
    const property = declarationProperty(part);
    if (!property) continue;
    said.set(
      property,
      part
        .slice(part.indexOf(':') + 1)
        .replace(/!important\s*$/i, '')
        .trim(),
    );
  }
  return said;
}

/** A rule's padding, px, top-right-bottom-left — the shorthand, then the
    longhands over it; `fallback` for a side neither says. */
function ruleSides(said: Map<string, string>, fallback = 0): [number, number, number, number] {
  const short = (said.get('padding') ?? '').split(/\s+/).filter(Boolean).map(cssPx);
  const [t = fallback, r = t, b = t, l = r] = short.map((side) => side ?? fallback);
  return [
    cssPx(said.get('padding-top')) ?? t,
    cssPx(said.get('padding-right')) ?? r,
    cssPx(said.get('padding-bottom')) ?? b,
    cssPx(said.get('padding-left')) ?? l,
  ];
}

/** A CSS length in px (`0` included) — null for anything else. */
function cssPx(value: string | undefined): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec((value ?? '').trim());
  return match && (match[2] || Number(match[1]) === 0) ? Number(match[1]) : null;
}

function recognise(node: Node, schema: Schema, head: string): AuthoredPageConversion | null {
  if (node.type.name !== 'htmlElement' || !/^(table|div|center)$/.test(node.attrs['tag'])) {
    return null;
  }
  const html = serializeToHTML(schema.topNodeType.create(null, node), schema);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rowsPage = handCodedPage(doc.body);
  if (rowsPage) return rowsPage;
  const centred = centredBands(doc.body);
  if (centred) return centred;
  const sheet = head ? stylesheetPage(doc.body, head) : null;
  if (sheet) return sheet;
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
    stylesheet: null,
    centred: null,
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
    stylesheet: null,
    centred: null,
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

/**
 * The centred column written band by band: the top block a `<div>` (the
 * body's wrapper) holding two bands or more and nothing else — no words, no
 * other element; its comments (Outlook's) aside — each band a `<div>` of
 * `max-width: Npx` (one N for all, 320–800) with auto side margins. The
 * page's colour is the wrapper's. Read off the style text, never the CSSOM
 * (an engine's reading of MJML's `background:` shorthand differs).
 */
function centredBands(root: Element): AuthoredPageConversion | null {
  const wrapper = soleChild(root);
  if (!(wrapper instanceof HTMLElement) || wrapper.tagName !== 'DIV') return null;
  const inside = meaningful(wrapper);
  if (inside.length < 2 || inside.some((node) => !(node instanceof HTMLElement))) return null;
  let width: number | null = null;
  for (const band of inside as HTMLElement[]) {
    const own = centredWidth(band);
    if (own === null || (width !== null && own !== width)) return null;
    width = own;
  }
  if (width === null || width < PAGE_WIDTH_MIN || width > PAGE_WIDTH_MAX) return null;
  return {
    shape: 'centred-bands',
    stylesheet: null,
    html: null,
    spacers: 0,
    sections: 0,
    rows: null,
    centred: {
      bands: inside.length,
      layout: centeredPageLayout({
        width,
        background: declaredFill(wrapper),
        columnBackground: null,
        spacing: 0,
        // Every band brings its own padding: no room of the column's own.
        inset: 0,
      }),
    },
  };
}

/** A band's own centring: a `<div>` of `max-width: Npx` with auto side
    margins — N, or null. A band already turned into a section of ours
    (authored-band.ts) centres its content column instead. */
function centredWidth(el: HTMLElement): number | null {
  if (el instanceof HTMLTableElement && markedAs(el) === 'section') {
    const column = el.rows[0]?.cells[0]?.firstElementChild;
    return column instanceof HTMLElement ? centredWidth(column) : null;
  }
  if (el.tagName !== 'DIV') return null;
  const style = declared(el);
  const width = /^(\d+(?:\.\d+)?)px$/i.exec(style.get('max-width') ?? '');
  if (!width) return null;
  if (style.get('margin-left') === 'auto' && style.get('margin-right') === 'auto') {
    return Number(width[1]);
  }
  const sides = (style.get('margin') ?? '').split(/\s+/).filter(Boolean);
  const right = sides[1];
  const left = sides.length === 4 ? sides[3] : sides[1];
  return right === 'auto' && left === 'auto' ? Number(width[1]) : null;
}

/** An element's declarations, by property, as its style text says them. */
function declared(el: Element): Map<string, string> {
  return new Map(
    parseDeclarations(el.getAttribute('style') ?? '').map(({ name, value }) => [
      name,
      value.trim(),
    ]),
  );
}

/** An element's fill as its style text (or `bgcolor`) says it — email-safe
    hex, or null for none or transparent. */
function declaredFill(el: Element): string | null {
  const style = declared(el);
  const raw =
    style.get('background-color') ?? style.get('background') ?? el.getAttribute('bgcolor') ?? '';
  return raw && raw !== 'transparent' && isSafeColor(raw) ? toEmailSafeColor(raw) : null;
}
