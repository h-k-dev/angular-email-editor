/**
 * The dual-contrast rule (we don't fight dark mode): a text color is only
 * offered if it reads against both a white and a near-black background, so
 * it survives light mode and forced dark-mode inversion without a single
 * dark-mode declaration in the output.
 *
 * Honest math note: 4.5:1 (WCAG AA body text) against *both* backgrounds is
 * mathematically empty — no color satisfies it. 3:1, the WCAG threshold for
 * large text and UI components, leaves a band of mid-tones; that band is the
 * palette. Enforcement lives here, at the affordance — colors hand-typed in
 * the HTML source are the author's own responsibility and are never policed.
 */

/** Light-mode reference background. */
export const DUAL_CONTRAST_LIGHT = '#ffffff';

/** Typical forced-inversion background (Gmail dark mode territory). */
export const DUAL_CONTRAST_DARK = '#121212';

/** WCAG large-text/UI threshold — see the math note above for why not 4.5. */
export const DUAL_CONTRAST_MIN_RATIO = 3;

function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` color. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * linearize((n >> 16) & 255) +
    0.7152 * linearize((n >> 8) & 255) +
    0.0722 * linearize(n & 255)
  );
}

/** WCAG contrast ratio between two `#rrggbb` colors, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whether a color reads against both the light and the dark reference. */
export function passesDualContrast(hex: string): boolean {
  return (
    contrastRatio(hex, DUAL_CONTRAST_LIGHT) >= DUAL_CONTRAST_MIN_RATIO &&
    contrastRatio(hex, DUAL_CONTRAST_DARK) >= DUAL_CONTRAST_MIN_RATIO
  );
}

export interface PaletteColor {
  name: string;
  value: string;
  /** Offered although it fails its palette's rule — and why. The palette
      tests hold every other swatch to the rule, and this one to failing it,
      so an exception is always a decision on record, never an accident. */
  exception?: string;
}

/** Flip a `#rrggbb` colour the way a forced-inversion client (Gmail/Outlook
    dark mode) roughly does: each channel to its complement. */
function invert(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = 255 - ((n >> 16) & 255);
  const g = 255 - ((n >> 8) & 255);
  const b = 255 - (n & 255);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * The dual-contrast rule for *backgrounds* (principle 9, again). Dark mode
 * hits a fill in two different ways, and a fill must survive both:
 *
 *   1. **Non-transforming dark modes** (Apple Mail, and any surface that only
 *      flips the *default text* to near-white while explicit styles stay):
 *      near-white text on an untouched pale fill is unreadable. No palette can
 *      fix this — the fix is that every fill is **paired with an explicit
 *      text colour** inline ({@link fillTextColor}), so the text on a fill
 *      never depends on the client's default.
 *   2. **Forced inversion** (Gmail/Outlook dark mode): fill *and* text are
 *      recoloured together — a pale fill becomes dark, its near-black text
 *      near-white; a dark fill becomes light, its white text dark. The pair
 *      must still read after that flip.
 *
 * Unlike the text rule (mid-tones), this selects the **ends**: pale tints
 * paired with near-black text, and near-blacks paired with white. Mid-tone
 * fills fail one side and are excluded — enforcement at the affordance, never
 * policing hand-typed source.
 */
export const DUAL_BACKGROUND_MIN_RATIO = 4.5;

/**
 * The text colour a pale fill carries (highlight span, table cell, column
 * panel) alongside its `background-color`. Near-black, so it reads on every
 * pale fill in light mode and in non-transforming dark modes; its complement
 * is near-white, so forced inversion keeps the pair readable. Emitted as an
 * *artifact of the fill* — parsing absorbs it back to "no explicit colour"
 * (see {@link isFillTextColor}), so it round-trips clean.
 */
export const FILL_TEXT_COLOR = '#202124';

/** {@link FILL_TEXT_COLOR} as the CSSOM serialises it. */
export const FILL_TEXT_COLOR_RGB = 'rgb(32, 33, 36)';

/** The text colour a dark fill carries: white — the mirror of
    {@link FILL_TEXT_COLOR}, for the same two dark-mode reasons. */
export const FILL_TEXT_COLOR_LIGHT = '#ffffff';

/** A `#rgb`, `#rrggbb` or CSSOM `rgb()` / `rgba()` colour as `#rrggbb`, or
    null for anything else (a keyword, a function this does not read). */
function toHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
  if (!rgb) return null;
  return (
    '#' +
    rgb
      .slice(1, 4)
      .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** A `#rrggbb` colour as the CSSOM serialises it. */
function cssomRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** The text a fill is paired with: white on a dark fill, near-black on
    anything else (a colour this cannot read included). */
export function fillTextColor(background: string): string {
  const hex = toHex(background);
  if (!hex) return FILL_TEXT_COLOR;
  return contrastRatio(hex, FILL_TEXT_COLOR_LIGHT) > contrastRatio(hex, FILL_TEXT_COLOR)
    ? FILL_TEXT_COLOR_LIGHT
    : FILL_TEXT_COLOR;
}

/** Whether a parsed `color` is the text paired with `background` (hex or
    CSSOM rgb form) — an emit artifact to absorb, not an authored colour to
    keep. */
export function isFillTextColor(raw: string | null | undefined, background: string): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const paired = fillTextColor(background);
  return v === paired || v === cssomRgb(paired);
}

/** Whether a fill reads with the text it is paired with ({@link fillTextColor})
    both as-is (light mode and non-transforming dark modes) and after forced
    inversion. */
export function passesDualBackground(hex: string): boolean {
  const text = fillTextColor(hex);
  return (
    contrastRatio(hex, text) >= DUAL_BACKGROUND_MIN_RATIO && // paired text reads on it
    contrastRatio(invert(hex), invert(text)) >= DUAL_BACKGROUND_MIN_RATIO // and inverted
  );
}

/**
 * The curated background palette: white, pale tints and a near-black, all
 * passing {@link passesDualBackground} — proven by test. Shared by every
 * background affordance (text highlight, table cells, column panels) so fills
 * read the same everywhere and survive inversion. Black carries white text.
 */
export const emailBackgroundPalette: PaletteColor[] = [
  { name: 'White', value: '#ffffff' },
  { name: 'Gray', value: '#f1f3f4' },
  { name: 'Black', value: '#202124' },
  { name: 'Red', value: '#fce8e6' },
  { name: 'Orange', value: '#feefe3' },
  { name: 'Yellow', value: '#fef7e0' },
  { name: 'Green', value: '#e6f4ea' },
  { name: 'Teal', value: '#e0f2f1' },
  { name: 'Blue', value: '#e8f0fe' },
  { name: 'Purple', value: '#f3e8fd' },
  { name: 'Pink', value: '#fce7f0' },
];

/**
 * The curated text palette: mid-tone hues that pass {@link passesDualContrast}
 * — proven by test, not by promise. This is what a color picker should offer
 * instead of an arbitrary hex input.
 *
 * Black and white are the two exceptions (no neutral near either end passes:
 * the band runs from #616161 to #949494), offered because a writer needs
 * them — black to take coloured text back to plain, white for text on a dark
 * fill.
 */
export const emailTextPalette: PaletteColor[] = [
  {
    name: 'Black',
    value: '#202124',
    exception: 'Vanishes on a dark client that keeps explicit colours; inverters flip it.',
  },
  { name: 'Gray', value: '#5f6368' },
  {
    name: 'White',
    value: '#ffffff',
    exception: 'Invisible on a white page — it is for text on a dark fill.',
  },
  { name: 'Brown', value: '#8d6e63' },
  { name: 'Red', value: '#c5221f' },
  { name: 'Orange', value: '#c2410c' },
  { name: 'Amber', value: '#a05a00' },
  { name: 'Olive', value: '#808000' },
  { name: 'Green', value: '#188038' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Cyan', value: '#0e7490' },
  { name: 'Blue', value: '#1a73e8' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Pink', value: '#c2185b' },
];
