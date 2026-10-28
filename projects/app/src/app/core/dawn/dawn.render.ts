import {
  DAWN_SURFACE,
  InboundMessage,
  hasDocumentEnvelope,
  plainTextHTML,
  renderDawn,
} from '@h-k-dev/angular-email-editor';

/*
 * Reading with Dawn — the library's render engine (`renderDawn`): how an
 * email is drawn to be read, here and in every view built on it (the
 * inbox's `email-viewer`, the thumbnails, the Render bench), and the
 * editor's dark paper too (`createDarkRendering`). `dawnDocument` is its
 * reading frame, on the editor's paper.
 */

/**
 * The paper the editor writes on, light and dark — styles.scss's
 * `--email-paper-light` / `--email-paper-dark`, and the very surfaces an
 * email is read on (the client's light pane, and `DAWN_DARK_SURFACE`): what
 * is written on one is read on the same. Change one, change the other.
 */
export const PAPER = DAWN_SURFACE;

/** The paper's scheme: the editor's Appearance, resolved (core/theme/paper.ts). */
export type PaperScheme = keyof typeof PAPER;

export interface DawnOptions {
  /** Light or dark paper — the editor's own, or the reader's choice. */
  readonly scheme: PaperScheme;
  /** The side inset a simple email's text keeps, px — the frame round it
      lines it up with its header. An email that lays itself out
      (`laysItselfOut`: a newsletter, a page) runs edge to edge, whatever
      this says. None by default. */
  readonly inset?: number;
}

/**
 * Whether an email lays itself out, edge to edge, rather than being a simple
 * email's text: a whole document (its own `<html>` / `<body>`), or a body
 * wrapped whole in one full-width table — a page, the editor's
 * (`aee-layout-page`) or written by hand round a fixed 600px card. Such an
 * email centres its own column on its own fill; an inset round it only
 * squeezes the column off centre.
 */
export function laysItselfOut(html: string): boolean {
  if (hasDocumentEnvelope(html)) return true;
  const body = new DOMParser().parseFromString(`<body>${html}`, 'text/html').body;
  const [page, ...rest] = Array.from(body.children);
  if (!(page instanceof HTMLTableElement) || rest.length) return false;
  if ((body.textContent ?? '').trim() !== (page.textContent ?? '').trim()) return false;
  return page.getAttribute('width')?.trim() === '100%' || page.style.width === '100%';
}

/**
 * A received email as Dawn draws it, a document for a frame: on dark paper,
 * its own dark rules where it declares dark, Dawn's dark drawing of its
 * colours where it does not — as it came: nothing added to it. The surfaces are the paper's
 * colours, so it is the paper it lies on, the frame edge to edge: an email
 * that lays itself out (a newsletter, a page) runs to the frame's edges, a
 * simple email's body keeps `inset` at its sides.
 * Links leave for a tab of their own: a reading frame is never navigated
 * away from its email.
 *
 * Takes a fragment (a message body) or a whole document.
 */
export function dawnDocument(html: string, { scheme, inset = 0 }: DawnOptions): string {
  const document = renderDawn(html, { scheme });
  const sides = inset > 0 && !laysItselfOut(html) ? ` padding-inline: ${inset}px;` : '';
  const reading = `<base target="_blank"><style>body { margin: 0;${sides} }</style>`;
  return document.replace('</head>', `${reading}</head>`);
}

/** A received message's body as HTML to read: its HTML part, or — a
    text-only message — its text as lines (the library's plain-text
    reading, the one a plain-text draft is written in). */
export function messageHtml(message: InboundMessage): string {
  return message.html ?? plainTextHTML(message.text ?? '');
}
