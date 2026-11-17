import {
  DAWN_SURFACE,
  DawnRole,
  DawnScheme,
  VALUE_TOKEN,
  dawnDarkColor,
  parseCssColor,
  rgbaToHex,
} from './color';

/*
 * Dawn on CSS and HTML: every colour a declaration, a sheet, a legacy
 * attribute or a whole message paints, drawn dark by `dawnDarkColor` — and
 * nothing else touched. A background that is dark already and text that is
 * light already stay as written (`DawnRole`). A border, an outline, a
 * shadow follow the band they lie on (`DawnBand`): as written on a
 * background kept as written, drawn on any other.
 */

/** The properties that paint a colour. */
const COLOR_PROPERTY =
  /color|background|border|outline|shadow|fill|stroke|decoration|column-rule|caret|accent/i;

/** The properties that paint text. */
const INK_PROPERTY =
  /^(?:color|caret-color|fill|stroke|-webkit-text-(?:fill|stroke)-color|text-(?:decoration|emphasis)(?:-color)?)$/i;

/** What a colour-painting property paints: text, a background, or — a
    border, an outline, a shadow — neither: those follow their band. */
function roleOf(property: string): DawnRole | undefined {
  if (INK_PROPERTY.test(property)) return 'ink';
  return /^background/i.test(property) ? 'surface' : undefined;
}

/** A background as dark draws it: `kept` as written (dark already) or
    `drawn`. What lies on it follows: a border on a kept band stays as
    written too. */
export type DawnBand = 'kept' | 'drawn';

/** The band a declaration block paints — its `background` or
    `background-color`, the last colour said — or null where it paints
    none (no colour, or one mostly clear). */
export function dawnBandOf(text: string): DawnBand | null {
  let band: DawnBand | null = null;
  for (const [, property, value] of text.matchAll(/([\w-]+)\s*:\s*([^;]*)/g)) {
    if (!/^background(?:-color)?$/i.test(property)) continue;
    for (const token of value.match(VALUE_TOKEN) ?? []) {
      const color = parseCssColor(token);
      if (!color || color[3] < 0.5) continue;
      band = dawnDarkColor(token, 'surface') === token ? 'kept' : 'drawn';
    }
  }
  return band;
}

/** One declaration's value with each colour drawn dark; its `url(…)`s as
    they were — and all of it as it was where it follows a kept `band`. */
function darkValue(property: string, value: string, band?: DawnBand | null): string {
  const role = roleOf(property);
  if (!role && band === 'kept') return value;
  return value.replace(VALUE_TOKEN, (token) =>
    token.toLowerCase().startsWith('url(') ? token : dawnDarkColor(token, role),
  );
}

/** The colour-painting declarations of a block that dark changes, each
    drawn dark, as `[property, value]` — what a sheet laid over the block
    needs (the editor's dark paper). A border on a block that paints no
    band of its own follows the band beneath it, which only the page
    knows: it comes with its `written` value too, to keep on a kept band. */
export function dawnDarkDeclarationsOf(
  text: string,
): [property: string, value: string, written?: string][] {
  const out: [string, string, string?][] = [];
  const own = dawnBandOf(text);
  for (const [, property, value] of text.matchAll(/([\w-]+)\s*:\s*([^;]*)/g)) {
    if (!COLOR_PROPERTY.test(property)) continue;
    const written = value.trim();
    const drawn = darkValue(property, written, own);
    if (drawn === written) continue;
    if (own || roleOf(property)) out.push([property.toLowerCase(), drawn]);
    else out.push([property.toLowerCase(), drawn, written]);
  }
  return out;
}

/** A declaration block's text with each colour it paints drawn dark — its
    `url(…)`s and every other property untouched. Its borders follow the
    band it paints itself, else the one `beneath` it. */
export function dawnDarkDeclarations(text: string, beneath?: DawnBand | null): string {
  const band = dawnBandOf(text) ?? beneath;
  return text.replace(
    /([\w-]+)(\s*:\s*)([^;]*)/g,
    (whole, property: string, colon: string, value: string) =>
      COLOR_PROPERTY.test(property) ? property + colon + darkValue(property, value, band) : whole,
  );
}

/** A style sheet with each declaration block drawn dark — its selectors and
    at-rules as they were. */
export function dawnDarkStyleSheet(text: string): string {
  return text.replace(/\{([^{}]*)\}/g, (_, block: string) => `{${dawnDarkDeclarations(block)}}`);
}

/** The legacy colour attributes HTML email still writes. */
const LEGACY_COLOR_ATTRIBUTES: readonly [attribute: string, role?: DawnRole][] = [
  ['bgcolor', 'surface'],
  ['color', 'ink'],
  ['text', 'ink'],
  ['link', 'ink'],
  ['vlink', 'ink'],
  ['alink', 'ink'],
  ['bordercolor'],
];

/** A legacy attribute's colour drawn dark, as the #rrggbb it must be — null
    where it holds no colour, or one its `role` keeps as written. */
export function dawnDarkLegacyColor(value: string, role?: DawnRole): string | null {
  if (!parseCssColor(value)) return null;
  const token = dawnDarkColor(value, role);
  const drawn = parseCssColor(token);
  return drawn && token !== value ? rgbaToHex(drawn) : null;
}

/** A message drawn dark, in place: every style sheet, every style attribute,
    every legacy colour attribute. Pictures are not touched. */
export function dawnDarkDocument(doc: Document): void {
  // The bands first, read off the colours as written: an element's own
  // inline fill, else its `bgcolor`.
  const bands = new Map<Element, DawnBand>();
  for (const element of Array.from(doc.querySelectorAll('[style], [bgcolor]'))) {
    const band =
      dawnBandOf(element.getAttribute('style') ?? '') ??
      dawnBandOf(`background-color: ${element.getAttribute('bgcolor') ?? ''}`);
    if (band) bands.set(element, band);
  }
  /** The nearest band at or above an element. */
  const bandAt = (element: Element | null): DawnBand | null => {
    for (let at = element; at; at = at.parentElement) {
      const band = bands.get(at);
      if (band) return band;
    }
    return null;
  };
  for (const sheet of Array.from(doc.querySelectorAll('style'))) {
    sheet.textContent = dawnDarkStyleSheet(sheet.textContent ?? '');
  }
  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    element.setAttribute(
      'style',
      dawnDarkDeclarations(element.getAttribute('style') ?? '', bandAt(element.parentElement)),
    );
  }
  for (const [attribute, role] of LEGACY_COLOR_ATTRIBUTES) {
    for (const element of Array.from(doc.querySelectorAll(`[${attribute}]`))) {
      // A border colour on a kept band stays as written, like any border.
      if (!role && bandAt(element) === 'kept') continue;
      const drawn = dawnDarkLegacyColor(element.getAttribute(attribute) ?? '', role);
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
