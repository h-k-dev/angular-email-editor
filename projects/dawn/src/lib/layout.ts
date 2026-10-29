import { hasDocumentEnvelope } from './envelope';
import { parseDeclarations } from './style-text';

/** The narrowest column that is a layout's, px: a card is 480px and up (600
    is the norm), a signature or a logo rarely is. */
const COLUMN = 480;

/**
 * Whether an email lays itself out, edge to edge, rather than being a
 * letter: text that a reader sets in from the frame's sides. An email lays
 * itself out when it sets a column of its own — any part of it 480px wide
 * or more (`width`, `min-width` or `max-width`, in px: a fixed 600px card,
 * a centred `max-width` wrapper) — or when its body is wrapped whole in one
 * full-width table, a page. Such an email centres its column on its own
 * fill; an inset round it only squeezes the column, and scrolls it sideways
 * where it no longer fits.
 *
 * Asked of the body, a fragment's or a whole document's alike: how a client
 * packed the message (Outlook, Apple Mail and Thunderbird send even a
 * two-line letter as a whole document) says nothing of how it is laid out.
 * A quote (`<blockquote>`) is someone else's email, not this one's layout,
 * and an image is a figure in the text, however wide.
 */
export function laysItselfOut(html: string): boolean {
  const body = new DOMParser().parseFromString(
    hasDocumentEnvelope(html) ? html : `<body>${html}`,
    'text/html',
  ).body;
  return isPage(body) || Array.from(body.querySelectorAll<HTMLElement>('*')).some(setsAColumn);
}

/** A body wrapped whole in one full-width table: the editor's page
    (`aee-layout-page`), or one written by hand round its card. */
function isPage(body: HTMLElement): boolean {
  const [page, ...rest] = Array.from(body.children);
  if (!(page instanceof HTMLTableElement) || rest.length) return false;
  if ((body.textContent ?? '').trim() !== (page.textContent ?? '').trim()) return false;
  return page.getAttribute('width')?.trim() === '100%' || styleOf(page).get('width') === '100%';
}

function setsAColumn(element: HTMLElement): boolean {
  if (element instanceof HTMLImageElement || element.closest('blockquote')) return false;
  const style = styleOf(element);
  return [
    element.getAttribute('width'),
    ...['width', 'min-width', 'max-width'].map((name) => style.get(name)),
  ].some((length) => pixels(length) >= COLUMN);
}

/** An element's inline style, read off its attribute: a server DOM's
    `style` can lose the whole of it over one declaration it does not know
    (jsdom does, at a `border-radius` after a `background`). */
function styleOf(element: Element): Map<string, string> {
  return new Map(
    parseDeclarations(element.getAttribute('style') ?? '').map(({ name, value }) => [name, value]),
  );
}

/** A length in px — `600`, `600px` — or NaN: a percentage, or a unit a
    layout is not drawn in (Word measures its letters in pt). */
function pixels(length: string | null | undefined): number {
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(length ?? '');
  return match ? Number(match[1]) : NaN;
}
