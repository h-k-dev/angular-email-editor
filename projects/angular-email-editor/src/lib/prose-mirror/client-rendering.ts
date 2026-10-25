import { CSS_SUPPORT, EmailClient } from './client-support';
import {
  COLOR_SCHEME_RULE,
  DarkModePalette,
  emailDarkModePalette,
  markDarkMode,
} from './dark-mode';
import { hasDocumentEnvelope } from './envelope';
import { sentBody } from './email-document';
import { STACK_RULE } from './extensions/nodes/columns';

/** The clients a rendering can be drawn for: the three that matter, and
    that read HTML differently enough to look at one by one. */
export type RenderingClient = 'apple-mail' | 'gmail' | 'outlook-desktop';

export const RENDERING_CLIENTS: readonly RenderingClient[] = [
  'apple-mail',
  'gmail',
  'outlook-desktop',
];

export interface ClientRenderingOptions {
  /** Draw the client's dark mode: Apple Mail's dark surface under the
      email's own dark-mode rules, Gmail's and classic Outlook's forced
      inversion. */
  dark?: boolean;
  /** The reading pane: a phone draws the message edge to edge (iOS Mail,
      the Gmail app), a desktop pane keeps a margin round it. Default
      desktop. */
  pane?: 'phone' | 'desktop';
  /** The palette a fragment's dark variants come from — what
      `emailDocument` sends it with (dark-mode.ts); the library's by
      default, `false` for none. A whole document is drawn as it is. */
  darkMode?: DarkModePalette | false;
}

/**
 * The email as a client would draw it — a simulation, in a browser, of what
 * each client keeps of the HTML and what it drops, from the same
 * client-support data the linter reads. Not a screenshot service: what the
 * data says a client ignores is taken out, what only that client reads is
 * put in, and the client's own surface (its default face, size and colours)
 * is laid underneath. The result is a whole document for a sandboxed frame.
 *
 * - **Apple Mail** reads it all: the document as it is, on Apple's surface;
 *   in dark mode its `prefers-color-scheme: dark` rules apply, so a
 *   fragment's palette colours take their dark variants (dark-mode.ts).
 * - **Gmail** drops the comments, the form controls (a hamburger's
 *   checkbox and label), every `<style>` rule whose selector it cannot
 *   match (pseudo-classes, attribute selectors, sibling combinators), and
 *   the declarations the data marks as ignored there (position, flex and
 *   grid, transforms, animation). It reads no `prefers-color-scheme`,
 *   and its dark mode inverts the colours.
 * - **Outlook on Windows** reads what the Word engine reads: the
 *   conditional comments meant for it are opened (`[if mso]`, `[if mso |
 *   IE]`, `[if gte mso 9]`) and the parts kept from it are taken out
 *   (`[if !mso]><!-->` … `<!--<![endif]`); media queries go; the
 *   declarations the data marks as ignored go (`max-width`, a padding on
 *   anything but a cell, `border-radius`, background images, floats,
 *   shadows, and the rest), and an `inline-block` block stacks. VML is left
 *   standing — a browser draws none of it, so a picture behind text shows
 *   as the colour beneath, which is what an Outlook without VML shows too.
 *   Its dark mode (classic Outlook; the new one is Outlook.com's) recolours
 *   the message itself, as Gmail's does, onto its own dark surface.
 *
 * Takes a fragment (the editor's canonical HTML) or a whole document (an
 * import as it was pasted): a document keeps its head — its `<style>`,
 * subject to the client — with the client's surface laid before it. A
 * fragment is drawn as `emailDocument` sends it: its body as sent
 * (`sentBody` — the images fitted, the stacking columns marked, under the
 * head's phone rule) and its dark-mode classes and rules put in.
 * Outlook.com's markers (`[data-ogsc]`) are set by none
 * of the three, so their rules never apply here.
 */
export function renderForClient(
  html: string,
  client: RenderingClient,
  options: ClientRenderingOptions = {},
): string {
  const palette = options.darkMode ?? emailDarkModePalette;
  const fragment = !hasDocumentEnvelope(html);
  const sent = fragment ? sentBody(html) : html;
  const dark = palette && fragment ? markDarkMode(sent, palette) : null;
  const marked = dark ? dark.html : sent;
  const source = client === 'outlook-desktop' ? openOutlookConditionals(marked) : marked;
  const doc = new DOMParser().parseFromString(source, 'text/html');
  if (fragment) {
    const sheet = doc.createElement('style');
    sheet.textContent = STACK_RULE;
    doc.head.appendChild(sheet);
  }
  if (dark) {
    const sheet = doc.createElement('style');
    sheet.textContent = [COLOR_SCHEME_RULE, dark.css].filter(Boolean).join(' ');
    doc.head.appendChild(sheet);
  }
  for (const sheet of Array.from(doc.querySelectorAll('style'))) {
    sheet.textContent = resolveColorScheme(
      dropRules(sheet.textContent ?? '', OUTLOOK_COM_MARKER),
      client === 'apple-mail' && !!options.dark,
    );
  }
  if (client !== 'apple-mail') dropComments(doc);
  if (client === 'gmail') {
    for (const el of Array.from(
      doc.querySelectorAll('input, label, form, button, select, textarea'),
    )) {
      el.replaceWith(...Array.from(el.childNodes));
    }
    for (const sheet of Array.from(doc.querySelectorAll('style'))) {
      sheet.textContent = keepGmailRules(sheet.textContent ?? '');
    }
  }
  if (client === 'outlook-desktop') {
    for (const sheet of Array.from(doc.querySelectorAll('style'))) {
      sheet.textContent = dropMediaQueries(sheet.textContent ?? '');
    }
  }
  if (client !== 'apple-mail') dropIgnoredDeclarations(doc, client);
  const surface = doc.createElement('style');
  surface.textContent =
    SURFACE[client] +
    (options.pane === 'phone' ? ' body { margin: 0; }' : '') +
    (options.dark ? DARK[client] : '');
  doc.head.insertBefore(surface, doc.head.firstChild);
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.insertBefore(charset, doc.head.firstChild);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

/** Each client's surface: its reading pane's default face, size and
    colours, under whatever the email says for itself. Light whatever the
    viewer's own scheme is: the frame is the client, not the page round it. */
const SURFACE: Record<RenderingClient, string> = {
  'apple-mail': `
    :root { color-scheme: light !important; }
    body { margin: 16px; background: #ffffff; color: #000000;
           font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
           font-size: 15px; line-height: 1.35; -webkit-text-size-adjust: 100%; }
  `,
  gmail: `
    :root { color-scheme: light !important; }
    body { margin: 16px; background: #ffffff; color: #222222;
           font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.4;
           word-wrap: break-word; }
  `,
  'outlook-desktop': `
    :root { color-scheme: light !important; }
    body { margin: 16px; background: #ffffff; color: #000000;
           font-family: Calibri, Arial, sans-serif; font-size: 14.67px; line-height: 1.2; }
    /* The Word engine draws no block side by side: a column stacks. */
    div[style*="inline-block"] { display: block !important; width: auto !important; }
  `,
};

/** Each client's dark mode. Apple Mail turns the surface dark and leaves
    the message's colours to the message — its own dark-mode rules
    included. Gmail inverts the message, keeping the hue. Classic Outlook
    for Windows recolours it too (Litmus' "full invert"; it reads no
    dark-mode rule), onto its own #292929: `invert(a)` takes white to
    1 - a, so a = 1 - 41/255 lands the white page on it, and a picture,
    put through the inversion once more, comes out eased into the page's
    range. */
const DARK: Record<RenderingClient, string> = {
  'apple-mail': `
    :root { color-scheme: dark !important; }
    html { background: #1e1e1e; } body { background: #1e1e1e; color: #ffffff; }
  `,
  gmail: `
    html { filter: invert(1) hue-rotate(180deg); background: #ffffff; }
    img { filter: invert(1) hue-rotate(180deg); }
  `,
  'outlook-desktop': `
    html { filter: invert(0.8392) hue-rotate(180deg); background: #ffffff; }
    img { filter: invert(1) hue-rotate(180deg); }
  `,
};

/** Outlook.com's markers: set on a message it darkens, by none of the
    clients drawn here. */
const OUTLOOK_COM_MARKER = /\[data-ogs[bc]\]/i;

/** The stylesheet without the rules whose selector `marker` matches. */
function dropRules(css: string, marker: RegExp): string {
  return marker.test(css) ? rewriteRules(css, (selector) => !marker.test(selector)) : css;
}

/** `prefers-color-scheme` answered for the frame: `dark` true where the
    client is drawn dark and reads the query (Apple Mail), false everywhere
    else — a client that reads no such query never matches it, whatever
    the viewer's own scheme. */
export function resolveColorScheme(css: string, dark: boolean): string {
  return css.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, (_, scheme: string) =>
    (scheme.toLowerCase() === 'dark') === dark ? '(min-width: 0px)' : '(max-width: -1px)',
  );
}

/** The Word engine reads what the conditional comments keep for it, and
    not what they keep from it. */
function openOutlookConditionals(html: string): string {
  return (
    html
      // `<!--[if !mso]><!-->` … `<!--<![endif]-->`: for everyone but Outlook.
      .replace(/<!--\[if\s+!mso\]><!-->[\s\S]*?<!--<!\[endif\]-->/gi, '')
      // `<!--[if mso]>` … `<![endif]-->` (and `mso | IE`, `gte mso 9`): Outlook's own.
      .replace(
        /<!--\[if\s+(?:gte\s+|lte\s+|gt\s+|lt\s+)?mso(?:\s*\|\s*IE)?[^\]]*\]>([\s\S]*?)<!\[endif\]-->/gi,
        '$1',
      )
  );
}

function dropComments(doc: Document): void {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
}

/** Gmail keeps a rule whose selector it can match — elements, classes,
    ids, descendants — and drops one with a pseudo-class, an attribute
    selector or a sibling combinator; media queries it keeps. */
export function keepGmailRules(css: string): string {
  return rewriteRules(css, (selector) => !/[:\[~+]/.test(selector));
}

/** The Word engine reads no media query. */
export function dropMediaQueries(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const open = css.indexOf('{', at);
    if (open < 0) break;
    i = matchingBrace(css, open) + 1;
  }
  return out;
}

/** The stylesheet with only the rules `keep` says yes to, inside media
    queries too. */
function rewriteRules(css: string, keep: (selector: string) => boolean): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    const close = matchingBrace(css, open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    if (head.startsWith('@media')) {
      out += `${head} {${rewriteRules(body, keep)}}\n`;
    } else if (head.startsWith('@')) {
      out += `${head} {${body}}\n`;
    } else {
      const selectors = head
        .split(',')
        .map((s) => s.trim())
        .filter(keep);
      if (selectors.length) out += `${selectors.join(', ')} {${body}}\n`;
    }
    i = close + 1;
  }
  return out;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Takes out of every inline style what the data says the client ignores. */
function dropIgnoredDeclarations(doc: Document, client: EmailClient): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[style]'))) {
    const tag = el.tagName.toLowerCase();
    const kept = (el.getAttribute('style') ?? '')
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .filter((declaration) => {
        const colon = declaration.indexOf(':');
        if (colon < 0) return true;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        const value = declaration.slice(colon + 1).trim();
        return !CSS_SUPPORT.some(
          (issue) =>
            issue.property === property &&
            issue.ignoredBy.includes(client) &&
            (!issue.valuePattern || issue.valuePattern.test(value)) &&
            (!issue.onTags || issue.onTags.includes(tag)),
        );
      });
    if (kept.length) el.setAttribute('style', kept.join('; ') + ';');
    else el.removeAttribute('style');
  }
}
