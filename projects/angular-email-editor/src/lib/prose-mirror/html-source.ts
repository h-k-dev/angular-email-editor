/**
 * A tiny HTML source language: scanner, email-focused linter and formatter.
 * Powers the HTML source editor kit — syntax highlighting and diagnostics run
 * on the scanner, while the formatter pretty-prints through the browser's own
 * parser so its output is always well-formed.
 */
import { clientList, findCssIssues } from './client-support';

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
  // Tables are the most client-compatible layout there is.
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
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

/** A named attribute within a tag's span, with the source range of its
    value: `null` when absent, empty value at the name's range when the
    attribute is present without one. */
function attributeValueToken(
  source: string,
  scan: HtmlScan,
  tag: HtmlTag,
  name: string,
): { value: string; from: number; to: number } | null {
  let nameToken: HtmlToken | null = null;
  for (const token of scan.tokens) {
    if (token.from < tag.from || token.to > tag.to) continue;
    if (token.type === 'attributeName') {
      if (nameToken) break; // the named attribute came and went without a value
      if (source.slice(token.from, token.to).toLowerCase() === name) nameToken = token;
    } else if (token.type === 'attributeValue' && nameToken) {
      // Range of the value *content*, quotes excluded, so lint positions can
      // point at spans inside the value.
      const raw = source.slice(token.from, token.to);
      const quoted = raw.startsWith('"') || raw.startsWith("'");
      const closed = quoted && raw.length > 1 && raw.endsWith(raw[0]);
      return {
        value: raw.slice(quoted ? 1 : 0, closed ? -1 : undefined),
        from: token.from + (quoted ? 1 : 0),
        to: token.to - (closed ? 1 : 0),
      };
    }
  }
  return nameToken ? { value: '', from: nameToken.from, to: nameToken.to } : null;
}

/** The value of a named attribute within a tag's span: `null` when absent,
    `''` when present without a value. */
function attributeValue(
  source: string,
  scan: HtmlScan,
  tag: HtmlTag,
  name: string,
): string | null {
  return attributeValueToken(source, scan, tag, name)?.value ?? null;
}

/** Balance-checks the tag stream: unclosed tags, stray closers, closed void
    elements, warnings for tags outside the email-safe set — and for
    comments, which are never email content: the schema drops them on parse
    (loudly here, never silently). */
export function lintHTML(source: string, scan: HtmlScan = scanHTML(source)): HtmlDiagnostic[] {
  const diagnostics: HtmlDiagnostic[] = [];
  const stack: HtmlTag[] = [];

  // Ambiguous ampersands in text: entity-like but missing the ';'. Browsers
  // still decode the legacy forms ('&copy' → ©, '&#169' → ©), silently
  // changing the text. A plain '&' (followed by whitespace or punctuation)
  // is safe — the round trip normalizes it to '&amp;' without changing
  // meaning, so it is not worth a warning.
  for (const [regionFrom, regionTo] of textRegions(source, scan)) {
    const region = source.slice(regionFrom, regionTo);
    // Each form terminates on its own alphabet: '&#38b' decodes as '&' + 'b'.
    const ambiguous =
      /&(?:#x[0-9a-fA-F]+(?![0-9a-fA-F;])|#\d+(?![\d;])|[a-zA-Z][a-zA-Z0-9]*(?![a-zA-Z0-9;]))/g;
    for (let match; (match = ambiguous.exec(region)); ) {
      diagnostics.push({
        from: regionFrom + match.index,
        to: regionFrom + match.index + match[0].length,
        severity: 'warning',
        message: `Ambiguous "${match[0]}" — legacy entities decode without the ";"; write "&amp;${match[0].slice(1)}" for literal text or add the ";"`,
      });
    }
  }

  // Images without alt text: image-blocking clients (corporate Outlook,
  // Gmail before the tap) render only the alt — a missing one leaves a hole.
  for (const tag of scan.tags) {
    if (tag.kind !== 'open' || tag.name !== 'img' || !tag.terminated) continue;
    const alt = attributeValue(source, scan, tag, 'alt');
    if (!alt?.trim()) {
      diagnostics.push({
        from: tag.nameFrom,
        to: tag.nameTo,
        severity: 'warning',
        message:
          'Image without alt text — image-blocking clients render nothing in its place',
      });
    }
  }

  // Style declarations the floor clients ignore or mangle — data-driven from
  // the client-support module; the message names the client and what happens.
  for (const tag of scan.tags) {
    if (tag.kind !== 'open' || !tag.terminated) continue;
    const style = attributeValueToken(source, scan, tag, 'style');
    if (!style?.value) continue;
    const hasWidthAttribute = attributeValue(source, scan, tag, 'width') !== null;

    let offset = 0;
    for (const declaration of style.value.split(';')) {
      const declarationFrom = style.from + offset;
      offset += declaration.length + 1;

      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();

      // The image hybrid pairs max-width with a width attribute precisely
      // because Outlook ignores max-width — that combination is by design.
      if (property === 'max-width' && tag.name === 'img' && hasWidthAttribute) continue;

      const leading = /^\s*/.exec(declaration)![0].length;
      const trimmed = declaration.trimEnd().length;
      for (const issue of findCssIssues(property, value, tag.name)) {
        diagnostics.push({
          from: declarationFrom + leading,
          to: declarationFrom + trimmed,
          severity: 'warning',
          message: `"${property}" — ${clientList(issue.ignoredBy)}: ${issue.note}`,
        });
      }
    }
  }

  // Script URL schemes in attribute values: the email schema refuses them on
  // parse and mail clients block them — an error, not a taste question.
  let lastAttribute = '';
  for (const token of scan.tokens) {
    if (token.type === 'attributeName') {
      lastAttribute = source.slice(token.from, token.to).toLowerCase();
      continue;
    }
    if (token.type !== 'attributeValue') continue;
    const value = source.slice(token.from, token.to).replace(/^["']|["']$/g, '');
    if (/^\s*(javascript|vbscript)\s*:/i.test(value)) {
      diagnostics.push({
        from: token.from,
        to: token.to,
        severity: 'error',
        message: `"${lastAttribute}" uses a script URL — the schema refuses it and mail clients block it`,
      });
    }
  }

  for (const token of scan.tokens) {
    if (token.type !== 'comment') continue;
    if (source.slice(token.from, token.to).endsWith('-->')) {
      diagnostics.push({
        from: token.from,
        to: token.to,
        severity: 'warning',
        message: 'Comments are not email content — the schema drops them on the next parse',
      });
    } else {
      diagnostics.push({
        from: token.from,
        to: token.to,
        severity: 'error',
        message: 'Comment is never closed with "-->"',
      });
    }
  }

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

/** Complete character references (`&amp;`, `&#169;`, `&#xA9;`) — spans that
    edits and selection endpoints must treat as atomic: splitting one breaks
    the reference and changes the decoded text. */
export function entitySpans(source: string): [number, number][] {
  const pattern = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
  const spans: [number, number][] = [];
  for (let match; (match = pattern.exec(source)); ) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/** Text regions of the source — everything outside tags and comments. */
function textRegions(source: string, scan: HtmlScan): [number, number][] {
  const blocked = [
    ...scan.tags.map((tag): [number, number] => [tag.from, tag.to]),
    ...scan.tokens
      .filter((token) => token.type === 'comment')
      .map((token): [number, number] => [token.from, token.to]),
  ].sort((x, y) => x[0] - y[0]);

  const regions: [number, number][] = [];
  let cursor = 0;
  for (const [from, to] of blocked) {
    if (from > cursor) regions.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < source.length) regions.push([cursor, source.length]);
  return regions;
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

/** What the cursor is in the middle of typing, for autocomplete. */
export type CompletionContext =
  | { kind: 'tag'; query: string }
  | { kind: 'closing'; query: string }
  | { kind: 'attribute'; tag: string; query: string; existing: string[] }
  | { kind: 'style-property'; tag: string; query: string };

/**
 * Derives the completion context at a source offset — like the slash menu,
 * this reads the *document*, not keystrokes, so it survives any way the text
 * got there. Returns `null` when the cursor is in plain prose or a
 * non-`style` attribute value.
 */
export function completionContextAt(source: string, offset: number): CompletionContext | null {
  const before = source.slice(0, offset);

  const closing = /<\/([a-zA-Z][-\w]*)?$/.exec(before);
  if (closing) return { kind: 'closing', query: closing[1] ?? '' };

  const opening = /<([a-zA-Z][-\w]*)?$/.exec(before);
  if (opening) return { kind: 'tag', query: opening[1] ?? '' };

  // Inside an unterminated tag?
  const lt = before.lastIndexOf('<');
  if (lt < 0 || before.indexOf('>', lt) !== -1) return null;
  const fragment = before.slice(lt);
  const tag = /^<([a-zA-Z][-\w]*)/.exec(fragment)?.[1]?.toLowerCase();
  if (!tag) return null;

  // Inside a quoted attribute value: only style properties are completable.
  const inValue = /([a-zA-Z-]+)\s*=\s*(["'])((?:(?!\2).)*)$/.exec(fragment);
  if (inValue) {
    if (inValue[1].toLowerCase() !== 'style') return null;
    const declaration = inValue[3].split(';').pop() ?? '';
    if (declaration.includes(':')) return null; // typing a value, not a property
    return { kind: 'style-property', tag, query: declaration.trimStart() };
  }

  // Attribute position: after whitespace, possibly mid-word.
  const attribute = /\s([a-zA-Z-]*)$/.exec(fragment);
  if (attribute) {
    const existing = [...fragment.matchAll(/([a-zA-Z-]+)\s*=/g)].map((m) => m[1].toLowerCase());
    return { kind: 'attribute', tag, query: attribute[1], existing };
  }

  return null;
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
