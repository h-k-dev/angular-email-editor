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
 *      {@link FILL_TEXT_COLOR}** inline, so the text on a fill never depends
 *      on the client's default.
 *   2. **Forced inversion** (Gmail/Outlook dark mode): fill *and* text are
 *      recoloured together — the pale fill becomes dark, the paired near-black
 *      text becomes near-white. The pair must still read after that flip.
 *
 * Unlike the text rule (mid-tones), this selects **pale tints**: light enough
 * for the paired dark text now, and their complements dark enough for its
 * complement after inversion. Saturated fills fail one side and are excluded —
 * enforcement at the affordance, never policing hand-typed source.
 */
export const DUAL_BACKGROUND_MIN_RATIO = 4.5;

/**
 * The text colour every fill affordance (highlight span, table cell, column
 * panel) emits alongside its `background-color`. Near-black, so it reads on
 * every pale fill in light mode and in non-transforming dark modes; its
 * complement is near-white, so forced inversion keeps the pair readable.
 * Emitted as an *artifact of the fill* — parsing absorbs it back to "no
 * explicit colour" (see {@link isFillTextColor}), so it round-trips clean.
 */
export const FILL_TEXT_COLOR = '#202124';

/** {@link FILL_TEXT_COLOR} as the CSSOM serialises it. */
export const FILL_TEXT_COLOR_RGB = 'rgb(32, 33, 36)';

/** Whether a parsed `color` is the paired fill text (hex or CSSOM rgb form) —
    an emit artifact to absorb, not an authored colour to keep. */
export function isFillTextColor(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return v === FILL_TEXT_COLOR || v === FILL_TEXT_COLOR_RGB;
}

/** Whether a fill reads with its paired {@link FILL_TEXT_COLOR} both as-is
    (light mode and non-transforming dark modes) and after forced inversion. */
export function passesDualBackground(hex: string): boolean {
  return (
    contrastRatio(hex, DUAL_CONTRAST_LIGHT) < DUAL_BACKGROUND_MIN_RATIO && // fill stays pale
    contrastRatio(hex, FILL_TEXT_COLOR) >= DUAL_BACKGROUND_MIN_RATIO && // paired text reads on it
    contrastRatio(invert(hex), invert(FILL_TEXT_COLOR)) >= DUAL_BACKGROUND_MIN_RATIO // and inverted
  );
}

/**
 * The curated background palette: pale tints that pass {@link passesDualBackground}
 * — proven by test. Shared by every background affordance (text highlight, table
 * cells, column panels) so fills read the same everywhere and survive inversion.
 */
export const emailBackgroundPalette: PaletteColor[] = [
  { name: 'Gray', value: '#f1f3f4' },
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
 */
export const emailTextPalette: PaletteColor[] = [
  { name: 'Gray', value: '#5f6368' },
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
