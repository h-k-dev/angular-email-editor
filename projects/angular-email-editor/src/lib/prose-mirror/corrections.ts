/**
 * Mistakes other editors store — found, and offered as a fix the author
 * takes; never corrected on their own.
 *
 * The parse keeps markup as written (html.ts) — right for a builder's
 * template, and for what a WYSIWYG editor saved on the author's behalf too:
 * the author decides. Summernote (and the Word or Gmail markup pasted into
 * it) stores shapes that look fine in that editor and break in a mail
 * client. Each correction here moves one such shape toward what the author
 * saw, and is correct for any input — it never fires on markup that already
 * means what it shows. {@link storedMistakes} says what a document holds;
 * {@link fixStoredMistakes} applies them all, one undo step:
 *
 * - `mailto://a@b.de`, `tel://+49…` — Summernote's `checkLinkUrl` writes the
 *   scheme with slashes; no client reads the address after them.
 * - `http://{{link}}` — the same function glues a scheme onto a link that is
 *   only a placeholder; the placeholder already resolves to a whole URL.
 * - `<o:p>` — Word's paragraph-end marker. It renders nothing, but as an
 *   element nobody claims it turns the `<p>` around it into a container, and
 *   the line inside comes out nested.
 * - `class="MsoNormal"` with no stylesheet defining it — the Word styles stay
 *   behind on the clipboard; the class points at nothing.
 * - `<table class="table table-bordered">` — the borders were the host app's
 *   Bootstrap CSS, which no inbox has. They are written inline, as Bootstrap
 *   drew them.
 * - An inline element wrapped around blocks (`<font color><div>…</div></font>`,
 *   `<span style><div>…</div></span>`) — a client re-nests it and the blocks
 *   lose the formatting. The inline is pushed down into each block — a
 *   table's cells, for a table. A link round a block it means to be
 *   ({@link isBlockLink}: a card, a tile, all of it one link) is no
 *   mistake, and stays.
 * - A `<video>` — no client plays one. The intent, "watch this", becomes a
 *   link to its page.
 *
 * An `<iframe>` is another matter: the parse refuses it (executable
 * content), so it can never be offered afterwards. What it played stays as a
 * link where it stood — the refusal's own step ({@link refusedEmbedsAsLinks},
 * html.ts), not a correction.
 */
import { Node as DocNode } from 'prosemirror-model';
import { Command, Selection } from 'prosemirror-state';
import { declarationProperty, splitDeclarations } from './email-vocabulary';
import { parseDocument } from './envelope';
import { parseHTML, serializeToHTML } from './html';
import { videosAsLinks } from './embeds';

export { videoPage } from './embeds';

/** A kind of stored mistake ({@link storedMistakes}). */
export type StoredMistakeKind =
  | 'link-scheme'
  | 'video'
  | 'office-mark'
  | 'office-class'
  | 'bootstrap-borders'
  | 'inline-around-blocks';

/** One kind a document holds, and how many times. */
export interface StoredMistake {
  kind: StoredMistakeKind;
  count: number;
}

/** Applies every correction to a throwaway document, in place, and says
    what it changed — kinds that changed nothing left out. */
export function correctStoredMistakes(dom: Document): StoredMistake[] {
  const root = dom.body;
  const counts: [StoredMistakeKind, number][] = [
    ['video', videosAsLinks(root)],
    ['link-scheme', repairLinkSchemes(root)],
    ['office-mark', unwrapOfficeParagraphMarks(root)],
    ['office-class', dropDeadOfficeClasses(dom)],
    ['bootstrap-borders', inlineBootstrapTableBorders(dom)],
    ['inline-around-blocks', lowerInlinesAroundBlocks(root)],
  ];
  return counts.filter(([, count]) => count > 0).map(([kind, count]) => ({ kind, count }));
}

/** The stored mistakes a document holds — or an email, as HTML — read off
    a copy, the document untouched. Empty for none. */
export function storedMistakes(email: DocNode | string): StoredMistake[] {
  const html = typeof email === 'string' ? email : serializeToHTML(email, email.type.schema);
  return correctStoredMistakes(parseDocument(html));
}

/** Fixes every stored mistake in the document ({@link storedMistakes}) — its
    body read again from the corrected email, one undo step; the head (the
    envelope) as it was, nothing in it corrected. False where there is
    none. */
export const fixStoredMistakes: Command = (state, dispatch) => {
  const { schema } = state;
  const dom = parseDocument(serializeToHTML(state.doc, schema));
  if (!correctStoredMistakes(dom).length) return false;
  if (dispatch) {
    // The body alone (in its page, which the parse lifts again).
    const doc = parseHTML(dom.body.innerHTML, schema);
    const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
    const layout = doc.attrs['pageLayout'] ?? null;
    if (
      'pageLayout' in state.doc.attrs &&
      JSON.stringify(state.doc.attrs['pageLayout'] ?? null) !== JSON.stringify(layout)
    ) {
      tr.setDocAttribute('pageLayout', layout);
    }
    dispatch(tr.setSelection(Selection.atStart(tr.doc)).scrollIntoView());
  }
  return true;
};

// ── links ───────────────────────────────────────────────────────────────

/** `mailto://` and `tel://` back to the scheme a client reads; `http://` off
    a link that is one placeholder and nothing else. Returns how many. */
export function repairLinkSchemes(root: ParentNode): number {
  let count = 0;
  for (const link of Array.from(root.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href')!;
    const repaired = href
      .replace(/^\s*(mailto|tel):\/\//i, (_, scheme: string) => `${scheme.toLowerCase()}:`)
      .replace(/^\s*https?:\/\/(\{\{[^{}]*\}\})\s*$/i, '$1');
    if (repaired !== href) {
      link.setAttribute('href', repaired);
      count++;
    }
  }
  return count;
}

// ── Word ────────────────────────────────────────────────────────────────

/** `<o:p>` replaced by what it holds (an `&nbsp;` keeps an empty line).
    Returns how many. */
export function unwrapOfficeParagraphMarks(root: ParentNode): number {
  let count = 0;
  for (const mark of Array.from(root.querySelectorAll('*')).reverse()) {
    if (mark.tagName.toLowerCase() !== 'o:p') continue;
    mark.replaceWith(...Array.from(mark.childNodes));
    count++;
  }
  return count;
}

/** `Mso…` class names no `<style>` in the document mentions. Returns how
    many elements lost one. */
export function dropDeadOfficeClasses(dom: Document): number {
  const css = Array.from(dom.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  let count = 0;
  for (const element of Array.from(dom.body.querySelectorAll('[class]'))) {
    const names = element.getAttribute('class')!.split(/\s+/).filter(Boolean);
    const kept = names.filter(
      (name) => !/^Mso/.test(name) || new RegExp(`\\.${name}\\b`).test(css),
    );
    if (kept.length === names.length) continue;
    if (kept.length) element.setAttribute('class', kept.join(' '));
    else element.removeAttribute('class');
    count++;
  }
  return count;
}

// ── Bootstrap ───────────────────────────────────────────────────────────

/** Bootstrap 5's `.table.table-bordered`, as an inbox needs it: inline. */
const BORDERED_TABLE = ['width: 100%', 'border-collapse: collapse'];
const BORDERED_CELL = ['border: 1px solid #dee2e6', 'padding: 8px'];

/** Bordered tables whose borders came from a class no stylesheet here
    defines get them inline; declarations the author wrote win. Returns how
    many tables. */
export function inlineBootstrapTableBorders(dom: Document): number {
  const css = Array.from(dom.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  if (/\.table-bordered\b/.test(css)) return 0;

  const tables = Array.from(dom.body.querySelectorAll('table.table-bordered'));
  for (const table of tables) {
    addDeclarations(table, BORDERED_TABLE);
    for (const cell of Array.from(table.querySelectorAll('td, th'))) {
      if (cell.closest('table') === table) addDeclarations(cell, BORDERED_CELL);
    }
    const kept = table
      .getAttribute('class')!
      .split(/\s+/)
      .filter((name) => name && name !== 'table' && name !== 'table-bordered');
    if (kept.length) table.setAttribute('class', kept.join(' '));
    else table.removeAttribute('class');
  }
  return tables.length;
}

/** Appends declarations an element's style text does not set yet — as text,
    never through the CSSOM (jsdom misreads shorthands). */
function addDeclarations(element: Element, declarations: string[]): void {
  const style = element.getAttribute('style') ?? '';
  const own = new Set(splitDeclarations(style).map(declarationProperty));
  const added = declarations.filter((declaration) => !own.has(declarationProperty(declaration)));
  if (!added.length) return;
  const base = style.trim().replace(/;?$/, style.trim() ? '; ' : '');
  element.setAttribute('style', `${base}${added.join('; ')};`);
}

// ── inline around blocks ────────────────────────────────────────────────

/** Phrasing elements that carry formatting a block inside them would lose. */
const FORMATTING = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'font',
  'span',
  'sub',
  'sup',
  'small',
  'big',
]);

const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

const isBlock = (node: Node) =>
  node.nodeType === 1 && BLOCK.has((node as Element).tagName.toLowerCase());

/** `display` as a link says it for itself — anything but `inline`. */
const OWN_BOX = /^(?!inline$)[a-z-]+$/;

/**
 * A block link: an `<a>` round blocks that is meant to be round them — the
 * way HTML makes a whole card one link (`<a style="display:block"><table>…`).
 * It says so itself (a `display` of its own, in its style), or it holds a
 * table, which no link could be pushed into and stay one. Lowered, it would
 * be a link in every block, or in every cell: not what its author wrote, and
 * not a shape an editor stored by mistake.
 */
export function isBlockLink(element: Element): boolean {
  if (element.tagName.toLowerCase() !== 'a') return false;
  if (element.querySelector('table')) return true;
  const display = splitDeclarations(element.getAttribute('style') ?? '')
    .filter((declaration) => declarationProperty(declaration) === 'display')
    .map((declaration) =>
      declaration
        .slice(declaration.indexOf(':') + 1)
        .replace(/!important/i, '')
        .trim()
        .toLowerCase(),
    )
    .at(-1);
  return !!display && OWN_BOX.test(display);
}

/**
 * `<font color><div>a</div>b</font>` → `<div><font color>a</font></div><font color>b</font>`.
 * Each run of inline children keeps a copy of the wrapper; each block gets
 * one inside it, around its own content — recursively, so a block of blocks
 * hands it on down, and a table hands it to its cells. An `<hr>` or an empty
 * block takes none; a block link ({@link isBlockLink}) is left where it is.
 * Returns how many wrappers were lowered.
 */
export function lowerInlinesAroundBlocks(root: ParentNode): number {
  let count = 0;
  // Deepest first: an inner wrapper lowered hands its blocks to the outer one.
  for (const element of Array.from(root.querySelectorAll('*')).reverse()) {
    if (!element.isConnected || !FORMATTING.has(element.tagName.toLowerCase())) continue;
    if (!Array.from(element.childNodes).some(isBlock) || isBlockLink(element)) continue;
    lower(element);
    count++;
  }
  return count;
}

function lower(wrapper: Element): void {
  const replacement: Node[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (run.some((node) => node.nodeType !== 3 || node.textContent!.trim())) {
      const copy = wrapper.cloneNode(false) as Element;
      copy.append(...run);
      replacement.push(copy);
    } else {
      replacement.push(...run);
    }
    run = [];
  };
  for (const child of Array.from(wrapper.childNodes)) {
    if (!isBlock(child)) {
      run.push(child);
      continue;
    }
    flush();
    wrapInto(child as Element, wrapper);
    replacement.push(child);
  }
  flush();
  wrapper.replaceWith(...replacement);
}

/** Puts a copy of `wrapper` around a block's content — or, for a block of
    blocks, around each inner block's content; for a table, in each of its
    own cells (between a table and its rows it would be no HTML: a client
    moves it out, empty, and the cells lose what it carried). */
function wrapInto(block: Element, wrapper: Element): void {
  const tag = block.tagName.toLowerCase();
  if (tag === 'hr' || !block.childNodes.length) return;
  if (tag === 'table') {
    for (const cell of Array.from(block.querySelectorAll('td, th, caption'))) {
      if (cell.closest('table') === block) wrapInto(cell, wrapper);
    }
    return;
  }
  if (Array.from(block.childNodes).some(isBlock)) {
    const copy = wrapper.cloneNode(false) as Element;
    copy.append(...Array.from(block.childNodes));
    block.append(copy);
    lower(copy);
    return;
  }
  const copy = wrapper.cloneNode(false) as Element;
  copy.append(...Array.from(block.childNodes));
  block.append(copy);
}
