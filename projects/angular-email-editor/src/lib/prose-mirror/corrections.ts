/**
 * Mistakes other editors store, corrected on the way in.
 *
 * The `email` parse keeps authored markup as written — right for a builder's
 * template, wrong for what a WYSIWYG editor saved on the author's behalf.
 * Summernote (and the Word or Gmail markup pasted into it) stores shapes that
 * look fine in that editor and break in a mail client. Each correction here
 * repairs one such shape toward what the author saw, and is correct for any
 * input — it never fires on markup that already means what it shows:
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
 *   lose the formatting. The inline is pushed down into each block.
 * - A video embed (`<iframe>`, `<video>`) — no client plays one, and the
 *   vocabulary drops it. The intent, "watch this", stays as a link.
 *
 * Runs in the `email` parse only: `preserve` keeps the source as law, and
 * `repair` rewrites everything into canonical form anyway.
 */
import { declarationProperty, splitDeclarations } from './email-vocabulary';

/** Applies every correction to a parsed document, in place. */
export function correctStoredMistakes(dom: Document): void {
  const root = dom.body;
  embedsAsLinks(root);
  repairLinkSchemes(root);
  unwrapOfficeParagraphMarks(root);
  dropDeadOfficeClasses(dom);
  inlineBootstrapTableBorders(dom);
  lowerInlinesAroundBlocks(root);
}

// ── links ───────────────────────────────────────────────────────────────

/** `mailto://` and `tel://` back to the scheme a client reads; `http://` off
    a link that is one placeholder and nothing else. */
export function repairLinkSchemes(root: ParentNode): void {
  for (const link of Array.from(root.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href')!;
    const repaired = href
      .replace(/^\s*(mailto|tel):\/\//i, (_, scheme: string) => `${scheme.toLowerCase()}:`)
      .replace(/^\s*https?:\/\/(\{\{[^{}]*\}\})\s*$/i, '$1');
    if (repaired !== href) link.setAttribute('href', repaired);
  }
}

/** The page a viewer opens for an embedded player's address. */
export function videoPage(src: string): string {
  const url = src.trim().replace(/^\/\//, 'https://');
  const youtube = /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/i.exec(url);
  if (youtube) return `https://www.youtube.com/watch?v=${youtube[1]}`;
  const vimeo = /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/i.exec(url);
  if (vimeo) return `https://vimeo.com/${vimeo[1]}`;
  return url;
}

/** Each embedded player becomes a link to its page, where it stood. */
export function embedsAsLinks(root: ParentNode): void {
  for (const embed of Array.from(root.querySelectorAll('iframe[src], video[src]'))) {
    const page = videoPage(embed.getAttribute('src')!);
    if (!/^https?:\/\//i.test(page)) {
      embed.remove();
      continue;
    }
    const link = embed.ownerDocument.createElement('a');
    link.setAttribute('href', page);
    link.textContent = embed.getAttribute('title')?.trim() || page;
    embed.replaceWith(link);
  }
}

// ── Word ────────────────────────────────────────────────────────────────

/** `<o:p>` replaced by what it holds (an `&nbsp;` keeps an empty line). */
export function unwrapOfficeParagraphMarks(root: ParentNode): void {
  for (const mark of Array.from(root.querySelectorAll('*')).reverse()) {
    if (mark.tagName.toLowerCase() === 'o:p') mark.replaceWith(...Array.from(mark.childNodes));
  }
}

/** `Mso…` class names no `<style>` in the document mentions. */
export function dropDeadOfficeClasses(dom: Document): void {
  const css = Array.from(dom.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  for (const element of Array.from(dom.body.querySelectorAll('[class]'))) {
    const names = element.getAttribute('class')!.split(/\s+/).filter(Boolean);
    const kept = names.filter((name) => !/^Mso/.test(name) || new RegExp(`\\.${name}\\b`).test(css));
    if (kept.length === names.length) continue;
    if (kept.length) element.setAttribute('class', kept.join(' '));
    else element.removeAttribute('class');
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────

/** Bootstrap 5's `.table.table-bordered`, as an inbox needs it: inline. */
const BORDERED_TABLE = ['width: 100%', 'border-collapse: collapse'];
const BORDERED_CELL = ['border: 1px solid #dee2e6', 'padding: 8px'];

/** Bordered tables whose borders came from a class no stylesheet here
    defines get them inline; declarations the author wrote win. */
export function inlineBootstrapTableBorders(dom: Document): void {
  const css = Array.from(dom.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
  if (/\.table-bordered\b/.test(css)) return;

  for (const table of Array.from(dom.body.querySelectorAll('table.table-bordered'))) {
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
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'font', 'span', 'sub', 'sup', 'small', 'big',
]);

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'div', 'dl', 'dt', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

const isBlock = (node: Node) => node.nodeType === 1 && BLOCK.has((node as Element).tagName.toLowerCase());

/**
 * `<font color><div>a</div>b</font>` → `<div><font color>a</font></div><font color>b</font>`.
 * Each run of inline children keeps a copy of the wrapper; each block gets
 * one inside it, around its own content — recursively, so a block of blocks
 * hands it on down. An `<hr>` or an empty block takes none.
 */
export function lowerInlinesAroundBlocks(root: ParentNode): void {
  // Deepest first: an inner wrapper lowered hands its blocks to the outer one.
  for (const element of Array.from(root.querySelectorAll('*')).reverse()) {
    if (!element.isConnected || !FORMATTING.has(element.tagName.toLowerCase())) continue;
    if (Array.from(element.childNodes).some(isBlock)) lower(element);
  }
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
    blocks, around each inner block's content. */
function wrapInto(block: Element, wrapper: Element): void {
  if (block.tagName.toLowerCase() === 'hr' || !block.childNodes.length) return;
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
