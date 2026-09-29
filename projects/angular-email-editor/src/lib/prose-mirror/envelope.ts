/**
 * The document envelope: doctype, `<html>` and `<body>` attributes, and the
 * `<head>` — everything around the body that MJML-class tooling emits and
 * that the body's responsiveness depends on (the media queries driving
 * `.mj-column-per-50` live in the head). Gmail strips the head; other
 * clients honour it; either way it is the author's and rides along.
 *
 * It lives as an attribute of the document node, never as content, and the
 * head is stored in one **canonical, line-based form** (see
 * {@link canonicalHead}) so that formatting the source pane can never change
 * the canonical document — the formatter prints exactly these lines and the
 * next parse normalizes them straight back.
 */
import { REFUSED_TAGS, VOID_TAGS } from './html-tags';
import {
  AttributePairs,
  normalizeCommentText,
  normalizeCss,
  preservedAttributes,
} from './preserve';

export interface DocumentEnvelope {
  /** The doctype as re-emitted (`<!doctype html>`), or null when absent. */
  doctype: string | null;
  /** Attributes of `<html>`, in authored order. */
  html: AttributePairs;
  /** The head in canonical line form, `\n`-joined, unindented; `''` when empty. */
  head: string;
  /** Attributes of `<body>`, in authored order. */
  body: AttributePairs;
}

/** Whether HTML carries a document envelope rather than being a bare body
    fragment — a doctype or an explicit `html`/`head`/`body` tag. */
export function hasDocumentEnvelope(html: string): boolean {
  return /<(?:!doctype|html|head|body)(?=[\s>/])/i.test(html);
}

/** Parses HTML into a throwaway document. A bare fragment is parsed inside
    an explicit `<body>`: otherwise the HTML parser files a leading comment
    or `<style>` under the head, and body-only consumers would lose it. */
export function parseDocument(html: string): Document {
  const source = hasDocumentEnvelope(html) ? html : `<body>${html}`;
  return new DOMParser().parseFromString(source, 'text/html');
}

/** Reads the envelope off a parsed document. */
export function readEnvelope(dom: Document): DocumentEnvelope {
  return {
    doctype: doctypeString(dom.doctype),
    html: preservedAttributes(dom.documentElement),
    head: canonicalHead(dom.head),
    body: preservedAttributes(dom.body),
  };
}

function doctypeString(doctype: DocumentType | null): string | null {
  if (!doctype) return null;
  const name = doctype.name || 'html';
  if (doctype.publicId) {
    return `<!DOCTYPE ${name} PUBLIC "${doctype.publicId}" "${doctype.systemId}">`;
  }
  if (doctype.systemId) return `<!DOCTYPE ${name} SYSTEM "${doctype.systemId}">`;
  return `<!doctype ${name}>`;
}

/**
 * The head, one child per line: `<title>`/`<meta>`/`<link>` on a line each,
 * `<style>` with its CSS trimmed and re-indented by nesting, comments with
 * their inner indentation dropped. Whitespace-only normalization, idempotent —
 * so the head string is a fixpoint of parse → serialize → format → parse.
 * Executable content (`<script>`, `<base>`) never makes it in.
 */
export function canonicalHead(head: Element | null): string {
  if (!head) return '';
  const lines: string[] = [];
  for (const node of Array.from(head.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) {
      lines.push(`<!--${normalizeCommentText(node.nodeValue ?? '')}-->`);
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (text) lines.push(escapeText(text));
      continue;
    }
    if (!(node instanceof Element)) continue;

    const tag = node.tagName.toLowerCase();
    if (REFUSED_TAGS.has(tag)) continue;
    const open = openTag(tag, preservedAttributes(node));
    if (VOID_TAGS.has(tag)) {
      lines.push(open);
    } else if (tag === 'style') {
      lines.push(
        open,
        ...normalizeCss(node.textContent ?? '').map((line) => `  ${line}`),
        '</style>',
      );
    } else {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      lines.push(`${open}${escapeText(text)}</${tag}>`);
    }
  }
  return lines.join('\n');
}

/** The canonical document: envelope lines around the zero-whitespace body. */
export function serializeDocument(envelope: DocumentEnvelope, body: string): string {
  const lines: string[] = [];
  if (envelope.doctype) lines.push(envelope.doctype);
  lines.push(openTag('html', envelope.html), '<head>');
  if (envelope.head) lines.push(envelope.head);
  lines.push('</head>', `${openTag('body', envelope.body)}${body}</body>`, '</html>');
  return lines.join('\n');
}

/** An opening tag with escaped attribute values; a valueless attribute is
    written bare (`<td nowrap>`), matching how the browser serializes it. */
export function openTag(tag: string, attrs: AttributePairs): string {
  let out = `<${tag}`;
  for (const [name, value] of attrs) {
    out += value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
  }
  return `${out}>`;
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
