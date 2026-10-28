import { DAWN_SURFACE, DawnScheme, VALUE_TOKEN, dawnDarkColor, parseCssColor, rgbaToHex } from './color';

/*
 * Dawn on CSS and HTML: every colour a declaration, a sheet, a legacy
 * attribute or a whole message paints, drawn dark by `dawnDarkColor` — and
 * nothing else touched.
 */

/** The properties that paint a colour. */
const COLOR_PROPERTY =
  /color|background|border|outline|shadow|fill|stroke|decoration|column-rule|caret|accent/i;

/** One declaration's value with each colour drawn dark; its `url(…)`s as
    they were. */
function darkValue(value: string): string {
  return value.replace(VALUE_TOKEN, (token) =>
    token.toLowerCase().startsWith('url(') ? token : dawnDarkColor(token),
  );
}

/** The colour-painting declarations of a block that dark changes, each
    drawn dark, as `[property, value]` — what a sheet laid over the block
    needs (the editor's dark paper). */
export function dawnDarkDeclarationsOf(text: string): [property: string, value: string][] {
  const out: [string, string][] = [];
  for (const [, property, value] of text.matchAll(/([\w-]+)\s*:\s*([^;]*)/g)) {
    if (!COLOR_PROPERTY.test(property)) continue;
    const drawn = darkValue(value.trim());
    if (drawn !== value.trim()) out.push([property.toLowerCase(), drawn]);
  }
  return out;
}

/** A declaration block's text with each colour it paints drawn dark — its
    `url(…)`s and every other property untouched. */
export function dawnDarkDeclarations(text: string): string {
  return text.replace(
    /([\w-]+)(\s*:\s*)([^;]*)/g,
    (whole, property: string, colon: string, value: string) =>
      COLOR_PROPERTY.test(property) ? property + colon + darkValue(value) : whole,
  );
}

/** A style sheet with each declaration block drawn dark — its selectors and
    at-rules as they were. */
export function dawnDarkStyleSheet(text: string): string {
  return text.replace(/\{([^{}]*)\}/g, (_, block: string) => `{${dawnDarkDeclarations(block)}}`);
}

/** The legacy colour attributes HTML email still writes. */
const LEGACY_COLOR_ATTRIBUTES = ['bgcolor', 'color', 'text', 'link', 'vlink', 'alink', 'bordercolor'];

/** A legacy attribute's colour drawn dark, as the #rrggbb it must be — null
    where it holds no colour. */
export function dawnDarkLegacyColor(value: string): string | null {
  const drawn = parseCssColor(dawnDarkColor(value));
  return drawn && parseCssColor(value) ? rgbaToHex(drawn) : null;
}

/** A message drawn dark, in place: every style sheet, every style attribute,
    every legacy colour attribute. Pictures are not touched. */
export function dawnDarkDocument(doc: Document): void {
  for (const sheet of Array.from(doc.querySelectorAll('style'))) {
    sheet.textContent = dawnDarkStyleSheet(sheet.textContent ?? '');
  }
  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    element.setAttribute('style', dawnDarkDeclarations(element.getAttribute('style') ?? ''));
  }
  for (const attribute of LEGACY_COLOR_ATTRIBUTES) {
    for (const element of Array.from(doc.querySelectorAll(`[${attribute}]`))) {
      const drawn = dawnDarkLegacyColor(element.getAttribute(attribute) ?? '');
      if (drawn) element.setAttribute(attribute, drawn);
    }
  }
}

/** Whether the message says it handles dark itself: a `color-scheme` or
    `supported-color-schemes` naming dark, in a `<meta>` or its CSS. Dawn
    draws such a message with its own dark rules. */
export function declaresDark(doc: Document): boolean {
  for (const meta of Array.from(doc.querySelectorAll('meta[name]'))) {
    const name = meta.getAttribute('name')?.toLowerCase();
    if (
      (name === 'color-scheme' || name === 'supported-color-schemes') &&
      /\bdark\b/i.test(meta.getAttribute('content') ?? '')
    ) {
      return true;
    }
  }
  return Array.from(doc.querySelectorAll('style')).some((sheet) =>
    /(?:supported-)?color-schemes?\s*:[^;}]*\bdark\b/i.test(sheet.textContent ?? ''),
  );
}

/** The surface, and the browser's own colours a message leans on — its ink
    and its links — as Dawn draws them on `scheme`. */
export function dawnSurfaceRules(scheme: DawnScheme): string {
  const paint = (token: string) => (scheme === 'dark' ? dawnDarkColor(token) : token);
  return (
    `html { background: ${DAWN_SURFACE[scheme]}; }` +
    ` body { background: transparent; color: ${paint('#000000')}; }` +
    ` :where(a:link) { color: ${paint('#0000ee')}; }` +
    ` :where(a:visited) { color: ${paint('#551a8b')}; }`
  );
}
