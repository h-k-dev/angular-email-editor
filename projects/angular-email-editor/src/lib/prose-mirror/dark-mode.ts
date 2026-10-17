/**
 * Dark mode, written into the email: the palette's own dark variants
 * ({@link PaletteColor.dark}) for the clients that read an email's dark-mode
 * styles, so a curated colour reads at AA there too — which no single value
 * can do on a white page and a dark one at once (dual-contrast.ts).
 *
 * - **Apple Mail** (macOS, iOS) and **new Outlook / Outlook.com**: the
 *   document says it is drawn for both schemes (`color-scheme: light dark`),
 *   and each palette colour it carries takes its variant — through
 *   `@media (prefers-color-scheme: dark)` for Apple, `[data-ogsc]` /
 *   `[data-ogsb]` for Outlook, which marks a message it darkens that way.
 * - **Gmail** and **classic Outlook for Windows** read neither and invert
 *   the colours themselves; the light values are chosen to read after that
 *   inversion, and the rules sit in a `<style>` of their own, so a client
 *   that throws the block away keeps every other rule.
 *
 * Only the palette's colours move, and only where the move reads: a fill
 * goes dark when nothing in it wears a colour outside the palette (dark text
 * on it would vanish), and a text colour lights up when no background over
 * it stays light. A colour typed into the HTML source is the author's own,
 * as everywhere (principle 9) — it stays, and so does what holds it.
 *
 * The canonical HTML never carries any of this: {@link markDarkMode} works
 * on the email document only (`emailDocument`), and the editor shows the
 * same rendering through {@link darkModeEditorCss} — one set of selectors,
 * so the two cannot drift.
 */
import { PaletteColor, emailBackgroundPalette, emailTextPalette } from './dual-contrast';

/** The colours that move in dark mode — each one's `dark` variant. */
export interface DarkModePalette {
  readonly text: readonly PaletteColor[];
  readonly background: readonly PaletteColor[];
}

/** The library's palette, both sides. */
export const emailDarkModePalette: DarkModePalette = {
  text: emailTextPalette,
  background: emailBackgroundPalette,
};

/** The class a text colour's element wears in the email: `aee-dt-c5221f`. */
export const DARK_TEXT_CLASS = 'aee-dt-';
/** The class a fill's element wears in the email: `aee-db-fce8e6`. */
export const DARK_FILL_CLASS = 'aee-db-';

/** What a document says to be drawn in both schemes: Apple Mail then reads
    its dark-mode rules (and leaves its own recolouring be). */
export const COLOR_SCHEME_META =
  '<meta name="color-scheme" content="light dark">' +
  '<meta name="supported-color-schemes" content="light dark">';

/** The same, for the stylesheet. */
export const COLOR_SCHEME_RULE =
  ':root { color-scheme: light dark; supported-color-schemes: light dark; }';

interface Variant {
  /** `#rrggbb`, lowercase. */
  readonly hex: string;
  readonly dark: string;
  /** The elements that wear the colour, as written by the editor. */
  readonly selector: string;
}

/** The ways a colour is written in a style: as the editor writes it (`#hex`)
    and as the CSSOM serialises it (`rgb(r, g, b)`) — an rgb fill (columns)
    is kept in that form. */
function spellings(hex: string): string[] {
  const n = parseInt(hex.slice(1), 16);
  return [hex, `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`];
}

/** An element whose own text colour is `hex`. */
function textSelector(hex: string): string {
  return [
    ...spellings(hex).flatMap((value) => [
      `[style^="color: ${value}" i]`,
      `[style*="; color: ${value}" i]`,
    ]),
    `font[color="${hex}" i]`,
  ].join(', ');
}

/** An element filled with `hex` and nothing over it (no picture). */
function fillSelector(hex: string): string {
  return [
    ...spellings(hex).map((value) => `[style*="background-color: ${value}" i]`),
    `[bgcolor="${hex}" i]`,
  ]
    .map((selector) => `${selector}:not([style*="url(" i]):not([background])`)
    .join(', ');
}

/** Any element with a text colour of its own. */
const ANY_TEXT = '[style^="color" i], [style*="; color" i], [style*=";color" i], font[color]';
/** Any element with a background of its own. */
const ANY_FILL = '[style*="background" i], [bgcolor], [background]';

function variants(colors: readonly PaletteColor[], selector: (hex: string) => string): Variant[] {
  const seen = new Set<string>();
  const out: Variant[] = [];
  for (const color of colors) {
    const hex = color.value.toLowerCase();
    if (!color.dark || !/^#[0-9a-f]{6}$/.test(hex) || seen.has(hex)) continue;
    seen.add(hex);
    out.push({ hex, dark: color.dark.toLowerCase(), selector: selector(hex) });
  }
  return out;
}

interface Selectors {
  readonly text: Variant[];
  readonly fill: Variant[];
  /** A colour of its own that is none of the palette's. */
  readonly foreign: string;
  readonly anyFill: string;
  readonly mappedFill: string;
}

function selectors(palette: DarkModePalette): Selectors {
  const text = variants(palette.text, textSelector);
  const fill = variants(palette.background, fillSelector);
  const mappedText = text.map((v) => v.selector).join(', ');
  return {
    text,
    fill,
    foreign: mappedText ? `:is(${ANY_TEXT}):not(${mappedText})` : `:is(${ANY_TEXT})`,
    anyFill: ANY_FILL,
    mappedFill: fill.map((v) => v.selector).join(', '),
  };
}

export interface DarkModeMarking {
  /** The HTML with each moving colour's element wearing its class — the
      input itself, byte for byte, when nothing moves. */
  readonly html: string;
  /** The rules for the classes used: Apple's media query and Outlook's
      markers. Empty when nothing moves. */
  readonly css: string;
}

/**
 * Marks the palette's colours in an email body for dark mode: a fill that
 * goes dark wears `aee-db-<hex>`, a text colour that lights up wears
 * `aee-dt-<hex>`, and `css` holds the rules for exactly those classes.
 *
 * A fill goes dark when it is the palette's, nothing in it (itself
 * included) wears a colour outside the palette, and every background round
 * it goes dark too. A text colour lights up when it is the palette's and
 * every background over it (its own included) goes dark — so lit text never
 * stands on a light fill, nor dark text on a dark one.
 */
export function markDarkMode(
  html: string,
  palette: DarkModePalette = emailDarkModePalette,
): DarkModeMarking {
  const sel = selectors(palette);
  if (!sel.text.length && !sel.fill.length) return { html, css: '' };
  const template = document.createElement('template');
  template.innerHTML = html;
  const usedText = new Map<string, string>();
  const usedFill = new Map<string, string>();

  // Bottom-up: whether a subtree wears only the palette's colours.
  const clean = new Map<Element, boolean>();
  const visitClean = (el: Element): boolean => {
    let ok = !el.matches(sel.foreign);
    for (const child of Array.from(el.children)) ok = visitClean(child) && ok;
    clean.set(el, ok);
    return ok;
  };
  // Top-down: classes, under no background that stays light.
  const visit = (el: Element, underLight: boolean): void => {
    let light = underLight;
    if (el.matches(sel.anyFill)) {
      const fill = sel.fill.find((v) => el.matches(v.selector));
      if (fill && clean.get(el) && !underLight) {
        el.classList.add(DARK_FILL_CLASS + fill.hex.slice(1));
        usedFill.set(fill.hex, fill.dark);
      } else {
        light = true;
      }
    }
    if (!light) {
      const text = sel.text.find((v) => el.matches(v.selector));
      if (text) {
        el.classList.add(DARK_TEXT_CLASS + text.hex.slice(1));
        usedText.set(text.hex, text.dark);
      }
    }
    for (const child of Array.from(el.children)) visit(child, light);
  };
  const roots = Array.from(template.content.children);
  for (const root of roots) visitClean(root);
  for (const root of roots) visit(root, false);

  if (!usedText.size && !usedFill.size) return { html, css: '' };
  const textRules = [...usedText].map(
    ([hex, dark]) => `.${DARK_TEXT_CLASS}${hex.slice(1)} { color: ${dark} !important; }`,
  );
  const fillRules = [...usedFill].map(
    ([hex, dark]) => `.${DARK_FILL_CLASS}${hex.slice(1)} { background-color: ${dark} !important; }`,
  );
  const css = [
    `@media (prefers-color-scheme: dark) { ${[...fillRules, ...textRules].join(' ')} }`,
    ...fillRules.map((rule) => `[data-ogsb] ${rule}`),
    ...textRules.map((rule) => `[data-ogsc] ${rule}`),
  ].join('\n');
  return { html: template.innerHTML, css };
}

/**
 * The same dark rendering for the editor's own surface: every rule of
 * {@link markDarkMode}, as a stylesheet over the live text under `scope`
 * (the editor root while it shows dark) — the editor's markup is never
 * touched. Each colour hands its variant over in a custom property; two
 * rules then apply them where the email's classes would go.
 *
 *     darkModeEditorCss(palette, '.paper[data-color-scheme="dark"] > .aee-editor')
 */
export function darkModeEditorCss(
  scope: string,
  palette: DarkModePalette = emailDarkModePalette,
): string {
  const sel = selectors(palette);
  if (!sel.text.length && !sel.fill.length) return '';
  // A background that stays light: one outside the palette, or one holding a
  // colour outside it. Everything under it stays as it is.
  const darkFill = sel.mappedFill
    ? `:is(${sel.mappedFill}):not(${sel.foreign}):not(:has(${sel.foreign}))`
    : null;
  const lightFill = darkFill ? `:is(${sel.anyFill}):not(${darkFill})` : `:is(${sel.anyFill})`;
  const rules: string[] = [];
  for (const v of sel.fill)
    rules.push(`${scope} :is(${v.selector}) { --aee-dark-fill: ${v.dark}; }`);
  for (const v of sel.text)
    rules.push(`${scope} :is(${v.selector}) { --aee-dark-text: ${v.dark}; }`);
  if (darkFill) {
    rules.push(
      `${scope} ${darkFill}:not(${lightFill} *) { background-color: var(--aee-dark-fill) !important; }`,
    );
  }
  const mappedText = sel.text.map((v) => v.selector).join(', ');
  if (mappedText) {
    rules.push(
      `${scope} :is(${mappedText}):not(${lightFill}):not(${lightFill} *) { color: var(--aee-dark-text) !important; }`,
    );
  }
  return rules.join('\n');
}
