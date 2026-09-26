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
 */

/**
 * Drops every element hidden with an inline `display: none` (the sheet's
 * having been folded in, a rule's counts too). A builder's export hides
 * the part of a trick the client cannot pull off — the label of an
 * MJML hamburger menu, whose ☰ would otherwise stand in the message as
 * text — and the alternative of a responsive pair; a preview text sits
 * in such a block as well, and goes with it: an email of ours carries no
 * hidden text. Not `visibility` or `mso-hide`: those are a client's
 * concern, not a rendering's.
 */
export function dropHidden(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    if (!el.isConnected) continue;
    if (/(?:^|;)\s*display\s*:\s*none\b/i.test(el.getAttribute('style') ?? '')) el.remove();
  }
}

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
      const cell = table.rows[0].cells[0];
      const children = Array.from(cell.childNodes);
      if (cell.style.direction === 'rtl' || table.style.direction === 'rtl') children.reverse();
      table.replaceWith(...children);
    }
  }
}

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
  if (table.rows.length !== 1 || table.rows[0].cells.length !== 1) return false;
  const cell = table.rows[0].cells[0];
  return Array.from(cell.childNodes).every(
    (node) => node.nodeType === Node.ELEMENT_NODE || !node.textContent?.trim(),
  );
}

/** Whether a one-cell table carries what makes it a section: a fill on the
    cell, the table or the div wrapping it, or a padding on the cell. */
function isBand(table: HTMLTableElement): boolean {
  if (table.rows.length !== 1 || table.rows[0].cells.length !== 1) return false;
  const cell = table.rows[0].cells[0];
  const parent = table.parentElement;
  const declares = (el: Element, property: string) =>
    new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'i').test(el.getAttribute('style') ?? '');
  return !!(
    declares(cell, 'background(?:-color)?') ||
    cell.getAttribute('bgcolor') ||
    declares(table, 'background(?:-color)?') ||
    table.getAttribute('bgcolor') ||
    (parent instanceof HTMLElement &&
      parent.tagName === 'DIV' &&
      declares(parent, 'background(?:-color)?')) ||
    declares(cell, 'padding(?:-top|-right|-bottom|-left)?')
  );
}
