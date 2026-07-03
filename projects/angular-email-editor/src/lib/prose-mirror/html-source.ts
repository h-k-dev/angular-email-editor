/**
 * A tiny HTML source language: scanner, email-focused linter and formatter.
 * Powers the HTML source editor kit — syntax highlighting and diagnostics run
 * on the scanner, while the formatter pretty-prints through the browser's own
 * parser so its output is always well-formed.
 */

export type HtmlTokenType = 'delimiter' | 'tagName' | 'attributeName' | 'attributeValue' | 'comment';

export interface HtmlToken {
  type: HtmlTokenType;
  from: number;
  to: number;
}

export interface HtmlTag {
  /** Lower-cased tag name. */
  name: string;
  kind: 'open' | 'close';
  selfClosing: boolean;
  /** False when the tag never reaches its `>` (e.g. `<div` at end of input). */
  terminated: boolean;
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
}

export interface HtmlScan {
  tokens: HtmlToken[];
  tags: HtmlTag[];
}

export interface HtmlDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

/** Tags the email schema understands; anything else risks being stripped or
    mangled by mail clients, so the linter flags it. */
export const EMAIL_SAFE_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'del', 'div', 'em', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li',
  'ol', 'p', 's', 'span', 'strike', 'strong', 'u', 'ul',
]);

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[-\w]/;
const WHITESPACE = /\s/;

/** Single-pass scanner producing highlight tokens and a tag event stream. */
export function scanHTML(source: string): HtmlScan {
  const tokens: HtmlToken[] = [];
  const tags: HtmlTag[] = [];
  let i = 0;

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      const to = end === -1 ? source.length : end + 3;
      tokens.push({ type: 'comment', from: lt, to });
      i = to;
      continue;
    }

    const isClose = source[lt + 1] === '/';
    const nameFrom = lt + (isClose ? 2 : 1);
    if (!NAME_START.test(source[nameFrom] ?? '')) {
      // A lone `<` in text (e.g. "a < b") is not markup.
      i = lt + 1;
      continue;
    }

    tokens.push({ type: 'delimiter', from: lt, to: nameFrom });
    let j = nameFrom;
    while (j < source.length && NAME_CHAR.test(source[j])) j++;
    const nameTo = j;
    tokens.push({ type: 'tagName', from: nameFrom, to: nameTo });

    let terminated = false;
    let selfClosing = false;
    scanAttributes: while (j < source.length) {
      while (j < source.length && WHITESPACE.test(source[j])) j++;
      if (j >= source.length) break;

      switch (source[j]) {
        case '>':
          tokens.push({ type: 'delimiter', from: j, to: j + 1 });
          j += 1;
          terminated = true;
          break scanAttributes;
        case '/':
          if (source[j + 1] === '>') {
            tokens.push({ type: 'delimiter', from: j, to: j + 2 });
            j += 2;
            terminated = true;
            selfClosing = true;
            break scanAttributes;
          }
          j++;
          continue;
        case '<':
          // Runaway tag: a new tag starts before this one was terminated.
          break scanAttributes;
        case '=': {
          tokens.push({ type: 'delimiter', from: j, to: j + 1 });
          j++;
          while (j < source.length && WHITESPACE.test(source[j])) j++;
          const quote = source[j];
          if (quote === '"' || quote === "'") {
            const closing = source.indexOf(quote, j + 1);
            const to = closing === -1 ? source.length : closing + 1;
            tokens.push({ type: 'attributeValue', from: j, to });
            j = to;
          } else {
            const start = j;
            while (j < source.length && !/[\s<>]/.test(source[j])) j++;
            if (j > start) tokens.push({ type: 'attributeValue', from: start, to: j });
          }
          continue;
        }
        default: {
          const start = j;
          while (j < source.length && !/[\s=/<>]/.test(source[j])) j++;
          if (j === start) j++; // stray character; never stall
          else tokens.push({ type: 'attributeName', from: start, to: j });
        }
      }
    }

    tags.push({
      name: source.slice(nameFrom, nameTo).toLowerCase(),
      kind: isClose ? 'close' : 'open',
      selfClosing,
      terminated,
      from: lt,
      to: j,
      nameFrom,
      nameTo,
    });
    i = j;
  }

  return { tokens, tags };
}

/** Balance-checks the tag stream: unclosed tags, stray closers, closed void
    elements, plus warnings for tags outside the email-safe set. */
export function lintHTML(source: string, scan: HtmlScan = scanHTML(source)): HtmlDiagnostic[] {
  const diagnostics: HtmlDiagnostic[] = [];
  const stack: HtmlTag[] = [];

  const unclosed = (tag: HtmlTag) =>
    diagnostics.push({
      from: tag.nameFrom,
      to: tag.nameTo,
      severity: 'error',
      message: `<${tag.name}> is never closed`,
    });

  for (const tag of scan.tags) {
    if (!tag.terminated) {
      diagnostics.push({
        from: tag.from,
        to: tag.to,
        severity: 'error',
        message: `"<${tag.kind === 'close' ? '/' : ''}${tag.name}" is missing its closing ">"`,
      });
      continue;
    }

    if (tag.kind === 'open') {
      if (!EMAIL_SAFE_TAGS.has(tag.name)) {
        diagnostics.push({
          from: tag.nameFrom,
          to: tag.nameTo,
          severity: 'warning',
          message: `<${tag.name}> is not email-safe — many mail clients strip it`,
        });
      }
      if (!VOID_TAGS.has(tag.name) && !tag.selfClosing) stack.push(tag);
      continue;
    }

    if (VOID_TAGS.has(tag.name)) {
      diagnostics.push({
        from: tag.from,
        to: tag.to,
        severity: 'error',
        message: `</${tag.name}> closes a void element that must not have a closing tag`,
      });
      continue;
    }

    let match = -1;
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].name === tag.name) {
        match = k;
        break;
      }
    }
    if (match === -1) {
      diagnostics.push({
        from: tag.from,
        to: tag.to,
        severity: 'error',
        message: `</${tag.name}> has no matching opening tag`,
      });
      continue;
    }
    // Everything opened after the match is implicitly (wrongly) closed by it.
    for (let k = stack.length - 1; k > match; k--) unclosed(stack[k]);
    stack.length = match;
  }

  for (const tag of stack) unclosed(tag);

  return diagnostics.sort((a, b) => a.from - b.from);
}

/** Names of tags still open at the end of the source, outermost first.
    Powers `</` auto-completion: the innermost open tag is the last entry. */
export function openTags(source: string, scan: HtmlScan = scanHTML(source)): string[] {
  const stack: string[] = [];
  for (const tag of scan.tags) {
    if (!tag.terminated) continue;
    if (tag.kind === 'open') {
      if (!VOID_TAGS.has(tag.name) && !tag.selfClosing) stack.push(tag.name);
    } else {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === tag.name) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return stack;
}

/** Block-level tags that get their own indented lines when formatting. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dd', 'dl', 'dt',
  'fieldset', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/**
 * Pretty-prints HTML for the source editor: block tags on their own indented
 * lines, inline content kept together. Parses through the browser's DOM, so
 * malformed input comes back auto-corrected — formatting is also repair.
 */
export function formatHTML(html: string, indent = '  '): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const lines: string[] = [];
  for (const child of Array.from(body.childNodes)) formatNode(child, 0, lines, indent);
  return lines.join('\n');
}

function formatNode(node: globalThis.Node, depth: number, lines: string[], indent: string): void {
  const pad = indent.repeat(depth);

  if (node.nodeType === Node.TEXT_NODE) {
    const text = collapseWhitespace(node.nodeValue ?? '').trim();
    if (text) lines.push(pad + escapeText(text));
    return;
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    lines.push(`${pad}<!--${node.nodeValue}-->`);
    return;
  }
  if (!(node instanceof Element)) return;

  const tag = node.tagName.toLowerCase();
  if (VOID_TAGS.has(tag)) {
    lines.push(pad + openTag(node));
    return;
  }
  if (!BLOCK_TAGS.has(tag) || !hasBlockChild(node)) {
    lines.push(pad + openTag(node) + inlineContent(node) + `</${tag}>`);
    return;
  }

  lines.push(pad + openTag(node));
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && !(child.nodeValue ?? '').trim()) continue;
    formatNode(child, depth + 1, lines, indent);
  }
  lines.push(`${pad}</${tag}>`);
}

function hasBlockChild(element: Element): boolean {
  for (const child of element.children) {
    if (BLOCK_TAGS.has(child.tagName.toLowerCase())) return true;
  }
  return false;
}

function inlineContent(element: Element): string {
  const parts: string[] = [];
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(escapeText(collapseWhitespace(child.nodeValue ?? '')));
    } else if (child.nodeType === Node.COMMENT_NODE) {
      parts.push(`<!--${child.nodeValue}-->`);
    } else if (child instanceof Element) {
      const tag = child.tagName.toLowerCase();
      parts.push(
        VOID_TAGS.has(tag) ? openTag(child) : openTag(child) + inlineContent(child) + `</${tag}>`,
      );
    }
  }
  // Whitespace between inline siblings is significant; only the edges are not.
  return parts.join('').replace(/^ +| +$/g, '');
}

function openTag(element: Element): string {
  let attrs = '';
  for (const attr of element.attributes) {
    attrs += attr.value === '' ? ` ${attr.name}` : ` ${attr.name}="${escapeAttribute(attr.value)}"`;
  }
  return `<${element.tagName.toLowerCase()}${attrs}>`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
