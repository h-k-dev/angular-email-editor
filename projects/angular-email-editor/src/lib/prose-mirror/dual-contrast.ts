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
