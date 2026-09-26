import { CSS_SUPPORT, EmailClient } from './client-support';

/** The clients a rendering can be drawn for: the three that matter, and
    that read HTML differently enough to look at one by one. */
export type RenderingClient = 'apple-mail' | 'gmail' | 'outlook-desktop';

export const RENDERING_CLIENTS: readonly RenderingClient[] = [
  'apple-mail',
  'gmail',
  'outlook-desktop',
];

export interface ClientRenderingOptions {
  /** Draw the client's dark mode: Gmail's forced inversion, Apple Mail's
      and Outlook's own dark surfaces. */
  dark?: boolean;
}

/**
 * The email as a client would draw it — a simulation, in a browser, of what
 * each client keeps of the HTML and what it drops, from the same
 * client-support data the linter reads. Not a screenshot service: what the
 * data says a client ignores is taken out, what only that client reads is
 * put in, and the client's own surface (its default face, size and colours)
 * is laid underneath. The result is a whole document for a sandboxed frame.
 *
 * - **Apple Mail** reads it all: the document as it is, on Apple's surface.
 * - **Gmail** drops the comments, the form controls (a hamburger's
 *   checkbox and label), every `<style>` rule whose selector it cannot
 *   match (pseudo-classes, attribute selectors, sibling combinators), and
 *   the declarations the data marks as ignored there (position, flex and
 *   grid, transforms, animation). Its dark mode inverts the colours.
 * - **Outlook on Windows** reads what the Word engine reads: the
 *   conditional comments meant for it are opened (`[if mso]`, `[if mso |
 *   IE]`, `[if gte mso 9]`) and the parts kept from it are taken out
 *   (`[if !mso]><!-->` … `<!--<![endif]`); media queries go; the
 *   declarations the data marks as ignored go (`max-width`, a padding on
 *   anything but a cell, `border-radius`, background images, floats,
 *   shadows, and the rest), and an `inline-block` block stacks. VML is left
 *   standing — a browser draws none of it, so a picture behind text shows
 *   as the colour beneath, which is what an Outlook without VML shows too.
 *
 * Takes a fragment (the editor's canonical HTML) or a whole document (an
 * import as it was pasted): a document keeps its head — its `<style>`,
 * subject to the client — with the client's surface laid before it.
 */
export function renderForClient(
  html: string,
  client: RenderingClient,
  options: ClientRenderingOptions = {},
): string {
  const source = client === 'outlook-desktop' ? openOutlookConditionals(html) : html;
  const doc = new DOMParser().parseFromString(source, 'text/html');
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
  surface.textContent = SURFACE[client] + (options.dark ? DARK[client] : '');
  doc.head.insertBefore(surface, doc.head.firstChild);
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  doc.head.insertBefore(charset, doc.head.firstChild);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

/** Each client's surface: its reading pane's default face, size and
    colours, under whatever the email says for itself. */
const SURFACE: Record<RenderingClient, string> = {
  'apple-mail': `
    body { margin: 16px; background: #ffffff; color: #000000;
           font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
           font-size: 15px; line-height: 1.35; -webkit-text-size-adjust: 100%; }
  `,
  gmail: `
    body { margin: 16px; background: #ffffff; color: #222222;
           font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.4;
           word-wrap: break-word; }
  `,
  'outlook-desktop': `
    body { margin: 16px; background: #ffffff; color: #000000;
           font-family: Calibri, Arial, sans-serif; font-size: 14.67px; line-height: 1.2; }
    /* The Word engine draws no block side by side: a column stacks. */
    div[style*="inline-block"] { display: block !important; width: auto !important; }
  `,
};

/** Each client's dark mode: Gmail (and Outlook's app) invert the message,
    keeping the hue; Apple Mail and Outlook on Windows turn the surface dark
    and leave the message's own colours to it. */
const DARK: Record<RenderingClient, string> = {
  'apple-mail': `
    html { background: #1e1e1e; } body { background: #1e1e1e; color: #ffffff; }
  `,
  gmail: `
    html { filter: invert(1) hue-rotate(180deg); background: #ffffff; }
    img { filter: invert(1) hue-rotate(180deg); }
  `,
  'outlook-desktop': `
    html { background: #292929; } body { background: #292929; color: #ffffff; }
  `,
};

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
