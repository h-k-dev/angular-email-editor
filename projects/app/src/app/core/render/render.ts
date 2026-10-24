import { DarkModePalette, renderForClient } from '@h-k-dev/angular-email-editor';

/**
 * The paper the editor writes on, light and dark — styles.scss's
 * `--email-paper-light` / `--email-paper-dark`, and the surface Apple Mail
 * reads an email on (the library's client rendering): what is written on
 * one is read on the same. Change one, change the other.
 */
export const PAPER = { light: '#ffffff', dark: '#1e1e1e' } as const;

/** The paper's scheme: the editor's Appearance, resolved (core/theme/paper.ts). */
export type PaperScheme = keyof typeof PAPER;

export interface ReadingOptions {
  /** Light or dark paper — the editor's own. */
  readonly scheme: PaperScheme;
  /** The palette whose dark variants the email was sent with; the
      library's by default. */
  readonly darkMode?: DarkModePalette | false;
}

/**
 * A received email as a document to read, for a frame: Apple Mail's
 * rendering — the client that reads it all, so the email's own dark-mode
 * rules and its palette colours' dark variants apply on dark paper, never a
 * filter — laid on the editor's paper, edge to edge. Links leave for a tab
 * of their own: a reading frame is never navigated away from its email.
 *
 * Takes a fragment (a message body) or a whole document, as
 * `renderForClient` does.
 */
export function readingDocument(html: string, { scheme, darkMode }: ReadingOptions): string {
  const document = renderForClient(html, 'apple-mail', {
    dark: scheme === 'dark',
    darkMode,
  });
  const paper =
    `<base target="_blank">` +
    `<style>html, body { background: ${PAPER[scheme]}; } body { margin: 0; }</style>`;
  return document.replace('</head>', `${paper}</head>`);
}
