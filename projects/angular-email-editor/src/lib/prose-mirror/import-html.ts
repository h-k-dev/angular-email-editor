/**
 * What a whole HTML document needs before the schema parses its body — the
 * two things a builder's export (MJML, Stripo, Mailchimp) leans on that the
 * canonical email HTML never has:
 *
 * 1. **A stylesheet.** The head's `<style>` rules are folded into the
 *    elements they match ({@link inlineStyles}), so the mobile-first pattern
 *    — `width: 100%` inline, `width: 50% !important` in a `min-width` media
 *    query — comes out the way a desktop client draws it.
 * 2. **Wrapper tables.** Every section, column and image sits in a one-cell
 *    `role="presentation"` table for Outlook's sake; each one would parse as
 *    a table of ours with its content hoisted out beside it. They are
 *    unwrapped ({@link unwrapLayoutTables}) — only the builders' own, which
 *    the canonical form never emits, and never one that carries a fill or a
 *    padding: that is a band, the section node's own.
 * 3. **Hidden elements.** What a builder hides with `display: none` — the
 *    trigger of a hamburger menu, a preview text, a desktop-only or
 *    mobile-only variant — is dropped ({@link dropHidden}), rather than
 *    read as text standing in the message: the schema has no notion of
 *    hidden, and the client the import is drawn for would not show it.
 * 4. **Inheritance.** A builder writes the colour, the size, the face and
 *    the alignment on a wrapping `<div>` or `<td>` and lets CSS carry them
 *    down; the schema reads a paragraph's alignment off the paragraph and
 *    a colour off a `<span>`. What an ancestor declares is written down
 *    onto the blocks and the runs beneath it ({@link inheritTextStyles}),
 *    so it reaches the words the way a client's cascade would.
 */

/**
 * Drops the comments, and every element hidden with an inline
 * `display: none` (the sheet's having been folded in, a rule's counts too). A builder's export hides
 * the part of a trick the client cannot pull off — the label of an
 * MJML hamburger menu, whose ☰ would otherwise stand in the message as
 * text — and the alternative of a responsive pair; a preview text sits
 * in such a block as well, and goes with it: an email of ours carries no
 * hidden text. Not `visibility` or `mso-hide`: those are a client's
 * concern, not a rendering's.
 */
export function dropHidden(root: ParentNode): void {
  // Comments first — a builder's Outlook conditionals stand between the
  // elements, and the schema never reads one; gone, a wrapper's cell is
  // seen to hold nothing but elements.
  const doc = root instanceof Document ? root : root.ownerDocument!;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: globalThis.Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    if (!el.isConnected) continue;
    if (/(?:^|;)\s*display\s*:\s*none\b/i.test(el.getAttribute('style') ?? '')) el.remove();
  }
}

import { isFillTextColor } from './dual-contrast';

/** The width the import is drawn at: an email's container. A `min-width`
    media query at or below it applies; a `max-width` one below it does not. */
export const IMPORT_VIEWPORT_WIDTH = 600;

interface Declaration {
  name: string;
  value: string;
  important: boolean;
}

/**
 * Folds the document's `<style>` rules into inline styles, then drops the
 * blocks. The cascade is the simple one an email tool can afford: a rule
 * applies to what its selector matches, in document order, later rules
 * over earlier ones; an inline declaration stands unless the rule is
 * `!important` (the mobile-first pattern relies on exactly that);
 * specificity is not weighed. Media queries are answered for
 * {@link IMPORT_VIEWPORT_WIDTH}; other at-rules and selectors the document
 * cannot match (`:hover`, `::before`) are skipped.
 */
export function inlineStyles(doc: Document, viewportWidth = IMPORT_VIEWPORT_WIDTH): void {
  const sheets = Array.from(doc.querySelectorAll('style'));
  if (!sheets.length) return;
  /** What the sheet itself set on an element: a later rule may replace it,
      where it may never replace what the element carried inline. */
  const fromSheet = new WeakMap<Element, Set<string>>();
  for (const sheet of sheets) {
    for (const rule of parseRules(sheet.textContent ?? '', viewportWidth)) {
      let matches: Element[];
      try {
        matches = Array.from(doc.querySelectorAll(rule.selector));
      } catch {
        continue;
      }
      for (const element of matches) {
        if (!(element instanceof HTMLElement)) continue;
        const own = fromSheet.get(element) ?? new Set<string>();
        fromSheet.set(element, own);
        for (const { name, value, important } of rule.declarations) {
          const inline = element.style.getPropertyValue(name);
          const inlineImportant = element.style.getPropertyPriority(name) === 'important';
          if (inline && !own.has(name) && !important) continue;
          if (inline && inlineImportant && !important) continue;
          element.style.setProperty(name, value, important ? 'important' : '');
          own.add(name);
        }
      }
    }
    sheet.remove();
  }
}

interface StyleRule {
  selector: string;
  declarations: Declaration[];
}

/** The style rules of a sheet, flattened: those inside a media query that
    holds at `viewportWidth`, in order; other at-rules dropped. */
export function parseRules(css: string, viewportWidth: number): StyleRule[] {
  const rules: StyleRule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('{', index);
    if (open < 0) break;
    const prelude = text.slice(index, open).trim();
    const close = matchingBrace(text, open);
    if (close < 0) break;
    const body = text.slice(open + 1, close);
    index = close + 1;
    if (!prelude) continue;
    if (prelude.startsWith('@')) {
      if (/^@media\b/i.test(prelude) && mediaMatches(prelude.slice(6), viewportWidth)) {
        rules.push(...parseRules(body, viewportWidth));
      }
      continue;
    }
    const declarations = parseDeclarations(body);
    if (!declarations.length) continue;
    for (const selector of prelude.split(',')) {
      const trimmed = selector.trim();
      if (!trimmed || /::?[a-z-]+/i.test(trimmed.replace(/:not\([^)]*\)/gi, ''))) continue;
      rules.push({ selector: trimmed, declarations });
    }
  }
  return rules;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function parseDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (!name || !value) continue;
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    declarations.push({ name, value, important });
  }
  return declarations;
}

/** Whether a media query list holds for a screen `viewportWidth` wide:
    `screen`/`all`, `min-width` and `max-width` in px, `and` between them;
    `not`, `print` and any other feature do not hold. */
export function mediaMatches(query: string, viewportWidth: number): boolean {
  return query.split(',').some((part) => {
    const q = part.trim().toLowerCase();
    if (!q) return false;
    if (/^not\b/.test(q) || /\bprint\b/.test(q)) return false;
    const rest = q.replace(/^only\s+/, '').replace(/^(screen|all)\b\s*(and\s*)?/, '');
    if (!rest.trim()) return true;
    for (const feature of rest.split(/\band\b/)) {
      const m = /^\s*\(\s*(min-width|max-width)\s*:\s*([\d.]+)px\s*\)\s*$/.exec(feature);
      if (!m) return false;
      const px = parseFloat(m[2]);
      if (m[1] === 'min-width' ? viewportWidth < px : viewportWidth > px) return false;
    }
    return true;
  });
}

/**
 * Takes the builders' wrapper tables out: a one-row, one-cell
 * `role="presentation"` table carrying the attributes the builders write
 * (`cellpadding`, `cellspacing`, `border="0"`) whose cell holds nothing but
 * elements — a column, another table, an image — is replaced by what it
 * holds. A cell written right-to-left (`direction: rtl`, MJML's way to put
 * an image on the right) hands its children over in reverse, which is the
 * order a client draws them in. Innermost first, until none is left. A
 * table with text in its one cell is a table, and stays one; the
 * canonical form's own tables carry none of those attributes.
 */
export function unwrapLayoutTables(root: ParentNode): void {
  for (;;) {
    const wrappers = Array.from(root.querySelectorAll('table')).filter(isWrapperTable);
    if (!wrappers.length) return;
    // Innermost first: a wrapper whose own wrapper goes first would move
    // with it and still be there next round — either way the loop ends.
    for (const table of wrappers.reverse()) {
      if (!table.isConnected) continue;
      const content: globalThis.Node[] = [];
      for (const row of Array.from(table.rows)) content.push(...cellContent(row.cells[0], table));
      table.replaceWith(...content);
    }
  }
}

/** What a wrapper's cell hands over: its children — reversed when written
    right-to-left — with the cell's own alignment (`align`, `text-align`)
    and padding carried onto them, since the cell goes: the alignment onto
    each block that has none of its own, and round the inline runs (a
    button, a row of links) as a paragraph of that alignment; the padding
    shared out as {@link distributePadding} does. */
function cellContent(cell: HTMLTableCellElement, table: HTMLTableElement): globalThis.Node[] {
  const children = Array.from(cell.childNodes);
  if (cell.style.direction === 'rtl' || table.style.direction === 'rtl') children.reverse();
  const align = alignmentOf(cell);
  const box = paddingOf(cell);
  if (!align && !box) return children;
  const out: globalThis.Node[] = [];
  let run: globalThis.Node[] = [];
  const flush = () => {
    if (run.some((node) => node.textContent?.trim() || node.nodeType === 1)) {
      const paragraph = cell.ownerDocument.createElement('div');
      if (align) paragraph.style.textAlign = align;
      paragraph.append(...run);
      out.push(paragraph);
    }
    run = [];
  };
  for (const child of children) {
    if (child instanceof HTMLElement && isBlock(child)) {
      flush();
      if (align && !alignsItself(child)) child.style.textAlign = align;
      out.push(child);
    } else {
      run.push(child);
    }
  }
  flush();
  if (box)
    distributePadding(
      box,
      out.filter((node): node is HTMLElement => node instanceof HTMLElement && isBlock(node)),
    );
  return out;
}

/** A box's four sides, in px — top, right, bottom, left. */
type Box = [number, number, number, number];

/** An element's padding, where it declares one that is not all zeros —
    the CSSOM's longhands, else the attribute's own shorthand. */
export function paddingOf(el: HTMLElement): Box | null {
  const px = (value: string): number => {
    const m = /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim());
    return m ? parseFloat(m[1]) : 0;
  };
  let box: Box;
  if (
    el.style.paddingTop ||
    el.style.paddingRight ||
    el.style.paddingBottom ||
    el.style.paddingLeft
  ) {
    box = [
      px(el.style.paddingTop),
      px(el.style.paddingRight),
      px(el.style.paddingBottom),
      px(el.style.paddingLeft),
    ];
  } else {
    const raw = inlineValue(el, 'padding');
    if (!raw) return null;
    const parts = raw.split(/\s+/).map(px);
    if (!parts.length || parts.length > 4) return null;
    const [t, r = t, b = t, l = r] = parts;
    box = [t, r, b, l];
  }
  return box.some((side) => side > 0) ? box : null;
}

/** Shares a dissolved box's padding out among the blocks it held, the way
    the box laid them out: the sides on every block, the top on the first,
    the bottom on the last — on top of any padding of their own. A table or
    a list takes none (they read no padding); a paragraph, a heading, a div
    do, and a paragraph's becomes its spacing. */
export function distributePadding(box: Box, blocks: HTMLElement[]): void {
  const takers = blocks.filter((block) => !/^(TABLE|UL|OL|HR)$/.test(block.tagName));
  takers.forEach((block, index) => {
    const own = paddingOf(block) ?? [0, 0, 0, 0];
    const next: Box = [
      own[0] + (index === 0 ? box[0] : 0),
      own[1] + box[1],
      own[2] + (index === takers.length - 1 ? box[2] : 0),
      own[3] + box[3],
    ];
    block.style.padding = next.map((side) => `${side}px`).join(' ');
  });
}

/** A cell's or block's own alignment — centre or right; left is the
    default, and not carried. */
function alignmentOf(el: HTMLElement): 'center' | 'right' | null {
  const align = (el.style.textAlign || el.getAttribute('align') || '').trim().toLowerCase();
  return align === 'center' || align === 'right' ? align : null;
}

/** Whether a block says where its text goes, left included — a said
    alignment is its own, and takes nothing from above. */
function alignsItself(el: HTMLElement): boolean {
  return !!(el.style.textAlign || el.getAttribute('align'));
}

const BLOCK_TAGS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'hr',
  'section',
  'article',
  'header',
  'footer',
]);

/** Whether an element lays out as a block — a column, a paragraph, a
    table — as against a run of a line (a link, an image, a span). */
export function isBlock(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName.toLowerCase());
}

/** Whether a cell holds a block of its own — what a section's does, as
    against a button's wrapper (one anchor) or an image's (one `<img>`). */
export function holdsBlock(cell: Element): boolean {
  return Array.from(cell.children).some(isBlock);
}

/** A builder's wrapper: one column of cells — one cell round a section,
    a column or an image, or the stack a column's blocks sit in, a row
    each — every cell holding elements alone. Never a table of ours: the
    canonical form writes none of the builders' attributes. */
function isWrapperTable(table: HTMLTableElement): boolean {
  if (table.getAttribute('role') !== 'presentation') return false;
  // A wrapper with a fill or a padding on it is a band — the section node's
  // to parse, not this pass's to take out.
  if (isBand(table)) return false;
  if (
    !table.hasAttribute('cellpadding') &&
    !table.hasAttribute('cellspacing') &&
    table.getAttribute('border') !== '0'
  ) {
    return false;
  }
  if (!table.rows.length) return false;
  return Array.from(table.rows).every(
    (row) =>
      row.cells.length === 1 &&
      Array.from(row.cells[0].childNodes).every(
        (node) => node.nodeType === Node.ELEMENT_NODE || !node.textContent?.trim(),
      ),
  );
}

/** Whether a one-cell table carries what makes it a section: a block in
    the cell (a button's wrapper round one anchor is a wrapper, whatever
    its fill), and a fill or an image on the cell, the table or the div
    wrapping it — or a padding on the cell round a *column* (a builder's
    section holds its columns; a builder's text block sits in a padded
    cell too, and is no band). */
function isBand(table: HTMLTableElement): boolean {
  if (table.rows.length !== 1 || table.rows[0].cells.length !== 1) return false;
  const cell = table.rows[0].cells[0];
  if (!holdsBlock(cell)) return false;
  const parent = table.parentElement;
  const declares = (el: Element, property: string) =>
    new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'i').test(el.getAttribute('style') ?? '');
  const filled = !!(
    declares(cell, 'background(?:-color|-image)?') ||
    cell.getAttribute('bgcolor') ||
    cell.getAttribute('background') ||
    declares(table, 'background(?:-color|-image)?') ||
    table.getAttribute('bgcolor') ||
    table.getAttribute('background') ||
    (parent instanceof HTMLElement &&
      parent.tagName === 'DIV' &&
      declares(parent, 'background(?:-color|-image)?'))
  );
  return filled || (isPadded(cell) && holdsColumn(cell));
}

/** Whether a cell declares a padding that is not all zeros. */
export function isPadded(cell: Element): boolean {
  const style = cell.getAttribute('style') ?? '';
  const m = /(?:^|;)\s*padding(?:-top|-right|-bottom|-left)?\s*:\s*([^;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = m.exec(style))) {
    if (!/^(0(?:px|em|rem|%)?\s*)+$/.test(match[1].trim())) return true;
  }
  return false;
}

/** Whether a cell holds a column — a builder's inline-block div, or our
    own centring div — which is what a section's cell holds. */
export function holdsColumn(cell: Element): boolean {
  return Array.from(cell.children).some(
    (child) =>
      child.tagName === 'DIV' &&
      (/inline-block/i.test((child as HTMLElement).style.display) ||
        !!(child as HTMLElement).style.maxWidth),
  );
}

/** An inline declaration's value: the CSSOM's reading, else the attribute's
    own words — an engine that trips on a shorthand before it drops the
    rest. */
function inlineValue(el: HTMLElement, property: string): string {
  const cssom = el.style.getPropertyValue(property).trim();
  if (cssom) return cssom;
  const m = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(
    el.getAttribute('style') ?? '',
  );
  return m?.[1]?.trim() ?? '';
}

/** What an ancestor's style hands down to the words: the properties CSS
    inherits that the schema reads — a colour, a size, a face off a
    `<span>`, an alignment off the block. */
const INHERITED = ['color', 'font-size', 'font-family', 'text-transform'] as const;

/**
 * Writes down what CSS would inherit. A builder puts `color`, `font-size`,
 * `font-family` and `text-align` on a wrapping `<div>` (MJML's text
 * block), or `align` on a cell, and the words beneath inherit them; the
 * schema reads a colour off a `<span>` and an alignment off the paragraph
 * itself, so the cascade is materialised: each declaring element hands
 * the properties to the blocks under it that declare none of their own
 * (alignment among them), and wraps its runs of inline content in a
 * `<span>` carrying the colour, the size and the face — an anchor's own
 * colour included, which is how a navbar's black links stay black. Top
 * down, so a grandchild takes the nearer ancestor's word. A `font-size`
 * of 0 (a builder's way to kill the gaps between inline-block columns)
 * is not a size and is not passed on.
 */
export function inheritTextStyles(root: ParentNode): void {
  const doc = root instanceof Document ? root : root.ownerDocument!;
  const declared = (el: HTMLElement): Partial<Record<(typeof INHERITED)[number], string>> => {
    const out: Partial<Record<(typeof INHERITED)[number], string>> = {};
    // A fill's paired text colour (our bands, columns and cells write one
    // beside the fill) is the fill's, not an authored colour: the span rule
    // absorbs it on a span, and it is not passed down here either.
    const fill = el.style.backgroundColor || el.getAttribute('bgcolor') || '';
    for (const property of INHERITED) {
      const value = inlineValue(el, property);
      if (!value || /^(inherit|initial|unset|transparent)$/i.test(value)) continue;
      if (property === 'font-size' && /^0(px|em|rem|%)?$/.test(value)) continue;
      if (property === 'color' && fill && isFillTextColor(value, fill)) continue;
      out[property] = value;
    }
    return out;
  };
  const visit = (el: HTMLElement): void => {
    const inherited = declared(el);
    // A heading's size is the heading's own (the schema's headings say
    // theirs), not a size to write onto its words.
    if (/^H[1-6]$/.test(el.tagName)) delete inherited['font-size'];
    const align = alignmentOf(el);
    // A span (or a legacy font) is read for its own styles by the schema:
    // nothing to hand down, and a span inside it would stand in its way.
    const passes = Object.keys(inherited).length > 0 && !/^(SPAN|FONT)$/.test(el.tagName);
    const made = new Set<Element>();
    let run: globalThis.Node[] = [];
    const flush = () => {
      const words = run.some((node) =>
        node.nodeType === Node.TEXT_NODE ? !!node.textContent?.trim() : node.nodeType === 1,
      );
      if (passes && words) {
        const span = doc.createElement('span');
        for (const [property, value] of Object.entries(inherited)) {
          span.style.setProperty(property, value);
        }
        el.insertBefore(span, run[0]);
        span.append(...run);
        made.add(span);
      }
      run = [];
    };
    for (const child of Array.from(el.childNodes)) {
      if (child instanceof HTMLElement && isBlock(child)) {
        flush();
        for (const [property, value] of Object.entries(inherited)) {
          if (!child.style.getPropertyValue(property)) child.style.setProperty(property, value);
        }
        if (align && !alignsItself(child) && child.tagName !== 'TABLE') {
          child.style.textAlign = align;
        }
      } else {
        run.push(child);
      }
    }
    flush();
    // A builder's plain wrapper div (no column, no centring div of ours: no
    // `display`, no `max-width`) with a padding round blocks: shared out
    // among them, since the schema reads a paragraph's box, not a div's.
    if (el.tagName === 'DIV' && !inlineValue(el, 'display') && !inlineValue(el, 'max-width')) {
      const blocks = Array.from(el.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && isBlock(child),
      );
      const box = blocks.length ? paddingOf(el) : null;
      if (box) {
        distributePadding(box, blocks);
        el.style.padding = '';
      }
    }
    // Down into the children with what they were handed. A span just made
    // holds what stood here — an anchor with a colour of its own among it,
    // which is visited in turn.
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (made.has(child)) {
        for (const inner of Array.from(child.children))
          if (inner instanceof HTMLElement) visit(inner);
      } else {
        visit(child);
      }
    }
  };
  for (const child of Array.from(root.children)) if (child instanceof HTMLElement) visit(child);
}
