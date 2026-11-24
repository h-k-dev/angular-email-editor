import {
  DAWN_SURFACE,
  type FoldQuotedOptions,
  InboundMessage,
  foldQuoted,
  laysItselfOut,
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
      (Dawn's `laysItselfOut`: a newsletter, a page) runs edge to edge, whatever
      this says. None by default. */
  readonly inset?: number;
  /** The history the message quotes — what an answer carries of the mail
      it answers — folded behind a `⋯` (Dawn's `foldQuoted`), the toggle
      called this for assistive tech ("Quoted text"), or full
      {@link FoldQuotedOptions} (e.g. custom CSS or `style: false`). Not
      folded by default: the whole message, as it came. */
  readonly fold?: string | FoldQuotedOptions;
}

/**
 * A received email as Dawn draws it, a document for a frame: on dark paper,
 * its own dark rules where it declares dark, Dawn's dark drawing of its
 * colours where it does not — as it came: nothing added to it. The surfaces are the paper's
 * colours, so it is the paper it lies on, the frame edge to edge: an email
 * that lays itself out (a newsletter, a page) runs to the frame's edges, a
 * simple email's body keeps `inset` at its sides.
 * Links leave for a tab of their own: a reading frame is never navigated
 * away from its email. It loads only what an email is drawn with
 * ({@link READING_CSP}).
 *
 * Takes a fragment (a message body) or a whole document.
 */
export function dawnDocument(html: string, { scheme, inset = 0, fold }: DawnOptions): string {
  // A toggle with no name folds nothing: it could not be told to assistive tech.
  const candidate = typeof fold === 'string' ? { label: fold } : fold;
  const foldOptions = candidate?.label.trim() ? candidate : undefined;
  const folded = foldOptions ? foldQuoted(html, foldOptions) : html;
  const document = renderDawn(folded, { scheme });
  // Folded, `laysItselfOut` ignores what is closed behind `⋯`: a short answer
  // over a quoted newsletter is a letter, and keeps its inset. (Dawn's surfaces
  // say the paper the quoted messages' boxes lie on.)
  const sides = inset > 0 && !laysItselfOut(folded) ? ` padding-inline: ${inset}px;` : '';
  const reading = `<base target="_blank"><style>body { margin: 0;${sides} }</style>`;
  return document
    .replace(/<head[^>]*>/, (head) => `${head}${READING_POLICY}`)
    .replace('</head>', `${reading}</head>`);
}

/**
 * What a reading frame may load, whatever its email asks for — the frame's
 * second lock, behind the sanitizer and the sandbox: nothing by default — no
 * script, no frame, no plugin, no request of its own, no form sent, no
 * `<base>` to bend its links — and only what an email is drawn with: its
 * styles and the fonts they name, its pictures and media. Remote pictures
 * still load; holding them back is Dawn's to do, on the document itself.
 *
 * A `<meta>`, first in the `<head>`: it holds for what is parsed after it,
 * and a `srcdoc` frame has no response header to carry it.
 */
export const READING_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https:",
  'font-src https: data:',
  'img-src http: https: data: blob:',
  'media-src https: data: blob:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const READING_POLICY = `<meta http-equiv="Content-Security-Policy" content="${READING_CSP}">`;

/** A received message's body as HTML to read: its HTML part, or — a
    text-only message — its text as lines (the library's plain-text
    reading, the one a plain-text draft is written in). */
export function messageHtml(message: InboundMessage): string {
  return message.html ?? plainTextHTML(message.text ?? '');
}
