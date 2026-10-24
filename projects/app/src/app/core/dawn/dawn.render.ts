import { InboundMessage, plainTextHTML } from '@h-k-dev/angular-email-editor';

import { renderDawnDark } from './dawn-dark.render';

/*
 * Dawn — the app's render engine: how an email is drawn to be read, here
 * and in every view built on it (the inbox's `email-viewer`, the Render
 * bench). `dawnDocument` is its document, on the editor's paper; its dark
 * mode is dawn dark (dawn-dark.render.ts).
 */

/**
 * The paper the editor writes on, light and dark — styles.scss's
 * `--email-paper-light` / `--email-paper-dark`, and the very surfaces an
 * email is read on (the client's light pane, and `DAWN_DARK_SURFACE`): what
 * is written on one is read on the same. Change one, change the other.
 */
export const PAPER = { light: '#ffffff', dark: '#1e1e1e' } as const;

/** The paper's scheme: the editor's Appearance, resolved (core/theme/paper.ts). */
export type PaperScheme = keyof typeof PAPER;

export interface DawnOptions {
  /** Light or dark paper — the editor's own, or the reader's choice. */
  readonly scheme: PaperScheme;
}

/**
 * A received email as Dawn draws it, a document for a frame: on dark paper,
 * its own dark rules where it declares dark, dawn dark's invert-lightness
 * turn on its colours where it does not — as it came: none of the editor's
 * palette variants added, it is not ours. The surfaces are the paper's
 * colours, so it is the paper it lies on; edge to edge. Links leave for a
 * tab of their own: a reading frame is never navigated away from its email.
 *
 * Takes a fragment (a message body) or a whole document.
 */
export function dawnDocument(html: string, { scheme }: DawnOptions): string {
  const document = renderDawnDark(html, { dark: scheme === 'dark', darkMode: false });
  const reading = '<base target="_blank"><style>body { margin: 0; }</style>';
  return document.replace('</head>', `${reading}</head>`);
}

/** A received message's body as HTML to read: its HTML part, or — a
    text-only message — its text as lines (the library's plain-text
    reading, the one a plain-text draft is written in). */
export function messageHtml(message: InboundMessage): string {
  return message.html ?? plainTextHTML(message.text ?? '');
}
