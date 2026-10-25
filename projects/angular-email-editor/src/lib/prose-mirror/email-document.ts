import { escapeAttribute, escapeText } from './utils/escape';
import { STACK_RULE, markStackingColumns } from './extensions/nodes/columns';
import { fitEmailImages } from './extensions/nodes/image';
import { pageCellOf, pageFillOf } from './page-layout';
import { fillTextColor } from './dual-contrast';
import {
  COLOR_SCHEME_META,
  COLOR_SCHEME_RULE,
  DARK_FILL_CLASS,
  DarkModePalette,
  emailDarkModePalette,
  markDarkMode,
} from './dark-mode';

export interface EmailDocumentOptions {
  /** The body's language (`en`, `ja`, `de`, …) — screen readers pick their
      voice from it, and for CJK it picks the glyph set: without `lang="ja"`
      a client may draw Japanese text with Chinese forms. */
  lang?: string;
  /** Text direction; `auto` (the default) lets the first strong character
      decide, so a right-to-left body renders right-to-left unasked. */
  dir?: 'ltr' | 'rtl' | 'auto';
  /** The document `<title>` — usually the subject. Webmail ignores it; the
      clients that open the message as a page (web views, some Android apps)
      show it. */
  title?: string;
  /** The inbox snippet shown next to the subject. Without it the client
      takes the first text it finds — often an image's alt or a greeting. */
  previewText?: string;
  /** The colours that take a dark variant where a client reads the
      email's dark-mode styles (dark-mode.ts) — the library's palette by
      default; a host with its own palette passes it. `false` leaves dark
      mode to the client: no `color-scheme`, no variants. */
  darkMode?: DarkModePalette | false;
}

/**
 * The body's head and shell: the fixes every mail client needs, none of which
 * belongs in the editor's canonical HTML.
 *
 * - Outlook on Windows scales everything by the screen DPI unless told the
 *   document is 96 DPI (`o:PixelsPerInch`), and blocks PNGs without
 *   `o:AllowPNG`. The Office XML sits in a conditional comment only Outlook
 *   reads; every other client drops comments.
 * - iOS enlarges small text unless `-webkit-text-size-adjust` says not to,
 *   and Apple Mail rewraps layouts unless
 *   `x-apple-disable-message-reformatting` is set.
 * - The body sits in `role="article" aria-roledescription="email"`, which
 *   screen readers announce as the message, carrying `lang` and `dir`.
 * - Images lose the border Outlook draws round a linked one, and one alone
 *   on its line — a logo — becomes a block, so no descender gap shows under
 *   it (`fitEmailImages`).
 *
 * Everything the email needs is inline. The head's one `<style>` rule is an
 * enhancement nothing depends on: on a phone a stacked column takes the
 * whole width instead of its desktop cap (columns.ts, `STACK_RULE`). A
 * client that strips the head (Gmail's app with a non-Google account)
 * keeps the cap — narrower, still whole — and loses nothing else, which is
 * the same rule the canonical HTML already keeps.
 *
 * A body in its page (page-layout.ts) paints the `<body>` with the page's
 * colour too, and its dark class: webmail drops the body and keeps the
 * page's 100% table; Apple Mail and Outlook keep the body, and with it the
 * colour reaches the window's edges below a short email.
 *
 * Dark mode is the other enhancement (dark-mode.ts): the document says it
 * is drawn for both schemes, and the palette's colours in it wear a class
 * that their dark variant hangs on, in a `<style>` of its own — a client
 * that reads none of it (Gmail, classic Outlook) inverts the light colours,
 * which are chosen to read inverted.
 *
 * The result is for the transport, not for the editor: parse and
 * `emailPlainText` take the fragment `serializeToHTML` returns (the preview
 * text would otherwise read as body text).
 */
export function emailDocument(html: string, options: EmailDocumentOptions = {}): string {
  const { lang, dir = 'auto', title, previewText, darkMode = emailDarkModePalette } = options;
  // Images first — no border, and no gap under one alone on its line
  // (image.ts); then the columns' stacking class, by pattern, on the markup
  // as the editor wrote it; the dark-mode classes join it on the element.
  const stacked = markStackingColumns(fitEmailImages(html));
  const dark = darkMode ? markDarkMode(stacked, darkMode) : null;
  const darkStyle = dark ? [COLOR_SCHEME_RULE, dark.css].filter(Boolean).join(' ') : '';
  const body = bodyFill(dark ? dark.html : stacked);
  const langAttr = lang ? ` lang="${escapeAttribute(lang)}"` : '';
  const dirAttr = ` dir="${dir}"`;
  return (
    '<!doctype html>' +
    `<html${langAttr}${dirAttr} xmlns="http://www.w3.org/1999/xhtml" ` +
    'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
    '<head>' +
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    (dark ? COLOR_SCHEME_META : '') +
    `<title>${escapeText(title ?? '')}</title>` +
    OUTLOOK_SETTINGS +
    `<style type="text/css">${STACK_RULE}</style>` +
    (dark ? `<style type="text/css">${darkStyle}</style>` : '') +
    '</head>' +
    `<body${body.className}` +
    ` style="${BODY_STYLE}${body.style}"${body.bgcolor}>` +
    `<div role="article" aria-roledescription="email"${langAttr}${dirAttr}>` +
    (previewText ? previewBlock(previewText) : '') +
    (dark ? dark.html : stacked) +
    '</div>' +
    '</body>' +
    '</html>'
  );
}

/** The page's colour on the body, as attribute pieces — empty for a body
    with no page, or a page with no colour. The class is the dark one the
    page's cell wears (markDarkMode), so the body darkens with it. */
function bodyFill(html: string): { className: string; style: string; bgcolor: string } {
  const none = { className: '', style: '', bgcolor: '' };
  if (!html.includes('aee-layout-page')) return none;
  const template = document.createElement('template');
  template.innerHTML = html;
  const cell = pageCellOf(template.content);
  const color = cell ? pageFillOf(cell) : null;
  if (!cell || !color) return none;
  const dark = Array.from(cell.classList).find((name) => name.startsWith(DARK_FILL_CLASS));
  return {
    className: dark ? ` class="${dark}"` : '',
    style: ` background-color: ${color}; color: ${fillTextColor(color)};`,
    bgcolor: ` bgcolor="${color}"`,
  };
}

const OUTLOOK_SETTINGS =
  '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings>' +
  '<o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch>' +
  '</o:OfficeDocumentSettings></xml></noscript><![endif]-->';

const BODY_STYLE =
  'margin: 0; padding: 0; word-spacing: normal; ' +
  '-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;';

/** Hidden everywhere (`mso-hide` for Outlook, which ignores `display: none`
    on a div). */
const PREVIEW_STYLE = 'display: none; max-height: 0; overflow: hidden; mso-hide: all;';

/** Invisible filler after the preview text: clients fill the snippet up to
    its length, and without the filler they would pull in the body's first
    words. Combining grapheme joiner, zero-width non-joiner and a no-break
    space per step — none renders, each counts as a character. */
const PREVIEW_FILLER = '&#847;&zwnj;&nbsp;'.repeat(90);

function previewBlock(text: string): string {
  return `<div style="${PREVIEW_STYLE}">${escapeText(text)}${PREVIEW_FILLER}</div>`;
}
