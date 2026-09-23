import { escapeAttribute, escapeText } from './utils/escape';

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
 *
 * Everything is inline — there is **no `<style>` block**: a client that
 * strips the head (Gmail's app with a non-Google account) loses nothing,
 * which is the same rule the canonical HTML already keeps.
 *
 * The result is for the transport, not for the editor: parse and
 * `emailPlainText` take the fragment `serializeToHTML` returns (the preview
 * text would otherwise read as body text).
 */
export function emailDocument(html: string, options: EmailDocumentOptions = {}): string {
  const { lang, dir = 'auto', title, previewText } = options;
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
    `<title>${escapeText(title ?? '')}</title>` +
    OUTLOOK_SETTINGS +
    '</head>' +
    `<body style="${BODY_STYLE}">` +
    `<div role="article" aria-roledescription="email"${langAttr}${dirAttr}>` +
    (previewText ? previewBlock(previewText) : '') +
    html +
    '</div>' +
    '</body>' +
    '</html>'
  );
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
