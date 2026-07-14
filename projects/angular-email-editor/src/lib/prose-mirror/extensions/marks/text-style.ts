import { defineMark } from '../../extension';
import { setMark } from './set.utils';
import { unsetMark } from './unset.utils';

/**
 * Allow only color values that can't smuggle extra declarations into the
 * `style` attribute: hex, rgb[a]/hsl[a] functional notation, or a bare CSS
 * named color. Mirrors the security-consciousness of the link mark's
 * `isSafeUrl`. `node.style.color` is already normalised by the browser's
 * CSSOM, but the legacy `<font color>` path and the programmatic `setColor`
 * command take raw strings, so we gate both.
 */
function isSafeColor(color: string | null | undefined): color is string {
  if (!color) return false;
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ||
    /^rgba?\([\d\s.,%]+\)$/i.test(color) ||
    /^hsla?\([\d\s.,%]+\)$/i.test(color) ||
    /^[a-z]+$/i.test(color)
  );
}

/**
 * Normalise any CSS color to a hex string the editor stores internally.
 * Call this before passing a color value to setColor — never store oklch/lab/hsl
 * in the mark attrs, because toDOM emits them verbatim into email HTML.
 */
export function toEmailSafeColor(raw: string): string | null {
  if (!raw) return null;

  // Already hex — fast path
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;

  // Use the browser's own color parser: assign to a hidden element's style,
  // read back the computed value (always rgb(...) or rgba(...)), then hex-encode.
  const el = document.createElement('span');
  el.style.color = raw; // browser parses + normalises
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color; // → "rgb(r, g, b)" or "rgba(...)"
  document.body.removeChild(el);

  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  if (!match) return null;

  const [, r, g, b] = match.map(Number);
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

const ALLOWED_SIZES = [10, 12, 14, 16, 18, 24, 32] as const;
export type FontSize = (typeof ALLOWED_SIZES)[number];

export function isSafeFontSize(value: unknown): value is FontSize {
  return ALLOWED_SIZES.includes(value as FontSize);
}

/**
 * Parse a font-size value from the DOM into one of our allowed sizes.
 * Handles px strings ("16px"), plain numbers, and rejects everything else.
 */
export function parseFontSize(raw: string | null | undefined): FontSize | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isSafeFontSize(n) ? n : null;
}

/**
 * The sizes the toolbar picker offers: the phone-safe subset (≥14px). Below
 * ~13px iOS auto-inflates text and reflows the layout (responsiveness ledger,
 * principle 8), so we don't *offer* those — but {@link parseFontSize} still
 * accepts the full {@link ALLOWED_SIZES} range, because a hand-typed size in
 * the HTML source pane is the author's own responsibility, exactly like a
 * hand-typed hex colour.
 */
export const emailFontSizes: FontSize[] = [14, 16, 18, 24, 32];

/** A curated, email-safe font stack the toolbar offers. */
export interface EmailFont {
  /** Toolbar label. */
  name: string;
  /** The exact `font-family` value emitted — the canonical stored form. */
  stack: string;
}

/**
 * The curated font stacks — the picker offers only these, no free-form fonts
 * (principle 7: if a mainstream client can't render it, we don't emit it).
 *
 * Deliberately built from *single-word* family identifiers plus a generic
 * fallback: a stack like `Courier New` would round-trip through the CSSOM
 * (serialization builds real elements and re-reads them) and come back quoted
 * as `"Courier New"` in Chrome but unquoted in jsdom — a byte-instability that
 * breaks canonical determinism and makes tests disagree with the runtime (the
 * same trap the longhand/`rgb()` rule guards against). Bare identifiers and
 * generic keywords serialize identically everywhere.
 */
export const emailFontFamilies: EmailFont[] = [
  { name: 'Sans-serif', stack: 'Arial, Helvetica, sans-serif' },
  { name: 'Serif', stack: 'Georgia, Times, serif' },
  { name: 'Monospace', stack: 'Courier, monospace' },
  { name: 'System', stack: 'system-ui, sans-serif' },
];

/** Normalise a `font-family` value to a comparison key: lower-cased, quotes
    dropped, whitespace around commas collapsed. Lets a hand-typed or CSSOM-
    reserialized stack match a curated one regardless of cosmetic differences. */
function fontFamilyKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

const FONT_STACK_BY_KEY = new Map(emailFontFamilies.map((f) => [fontFamilyKey(f.stack), f.stack]));

export function isSafeFontFamily(value: unknown): value is string {
  return typeof value === 'string' && FONT_STACK_BY_KEY.has(fontFamilyKey(value));
}

/**
 * Parse a font-family value from the DOM into one of our curated stacks,
 * returning the *canonical* stack string (so a cosmetically different but
 * equivalent input normalises to the exact bytes we emit). Rejects anything
 * outside the curated set — the schema is law.
 */
export function parseFontFamily(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return FONT_STACK_BY_KEY.get(fontFamilyKey(raw)) ?? null;
}

/**
 * TipTap-style `textStyle` mark: a `<span style="…">` container holding inline
 * text-styling attributes. We expose only `color` — the one styling primitive
 * that renders reliably across email clients.
 *
 * Modeled on `@tiptap/extension-text-style` + `@tiptap/extension-color`: color
 * is an *attribute* on a shared span rather than its own mark, so future
 * email-safe styles (e.g. background-color) can hang off the same span and
 * merge into one `style` string instead of nesting wrapper tags.
 */
export const TextStyle = defineMark({
  name: 'textStyle',
  spec: {
    attrs: {
      color: { default: null },
      fontSize: { default: null },
      fontFamily: { default: null },
    },
    // Don't let a color span bleed onto the next line on Shift-Enter.
    splittable: false,
    parseDOM: [
      {
        tag: 'span',
        getAttrs: (node) => {
          const color = isSafeColor(node.style?.color) ? node.style.color : null;
          const fontSize = parseFontSize(node.style?.fontSize);
          const fontFamily = parseFontFamily(node.style?.fontFamily);
          const backgroundColor = isSafeColor(node.style?.backgroundColor)
            ? node.style.backgroundColor
            : null;
          if (!color && !fontSize && !fontFamily && !backgroundColor) return false;
          return { color, fontSize, fontFamily, backgroundColor };
        },
      },
      {
        // Legacy <font color="…"> turns up in plenty of inbound email HTML.
        tag: 'font[color]',
        getAttrs: (node) => {
          const color = node.getAttribute('color');
          return isSafeColor(color) ? { color } : false;
        },
      },
    ],
    toDOM: (mark) => {
      const { color, fontSize, fontFamily, backgroundColor } = mark.attrs;
      const style = [
        color ? `color: ${color}` : null,
        fontSize ? `font-size: ${fontSize}px` : null,
        fontFamily ? `font-family: ${fontFamily}` : null,
        backgroundColor ? `background-color: ${backgroundColor}` : null,
      ]
        .filter(Boolean)
        .join('; ');
      return ['span', style ? { style } : {}, 0];
    },
  },
  commands: ({ schema }) => ({
    /**
     * Apply (or recolor) the selection. setMark merges attrs, so this also
     * updates an existing textStyle span in place rather than nesting.
     */
    setColor: (color: string) => (state, dispatch) => {
      const safeColor = toEmailSafeColor(color);
      return safeColor
        ? setMark(schema.marks['textStyle'], { color: safeColor })(state, dispatch)
        : false;
    },

    /**
     * Clear the color. `color` is textStyle's only attribute today, so this
     * drops the whole span; make it attribute-aware if more attrs are added.
     */
    unsetColor: () => unsetMark(schema.marks['textStyle'], ['color']),

    /**
     * Apply a font-size to the selection.
     */
    setFontSize: (size: number) => (state, dispatch) =>
      isSafeFontSize(size)
        ? setMark(schema.marks['textStyle'], { fontSize: size })(state, dispatch)
        : false,

    /**
     * Clear the font-size.
     */
    unsetFontSize: () => unsetMark(schema.marks['textStyle'], ['fontSize']),

    /**
     * Apply one of the curated font stacks to the selection. A value outside
     * the curated set is refused (the picker never sends one; a hand-typed
     * source-pane value is handled by the parser, not this command).
     */
    setFontFamily: (family: string) => (state, dispatch) => {
      const stack = parseFontFamily(family);
      return stack
        ? setMark(schema.marks['textStyle'], { fontFamily: stack })(state, dispatch)
        : false;
    },

    /**
     * Clear the font-family.
     */
    unsetFontFamily: () => unsetMark(schema.marks['textStyle'], ['fontFamily']),

    /**
     * Apply a background color to the selection.
     */
    setBackgroundColor: (color: string) => (state, dispatch) => {
      const safe = toEmailSafeColor(color);
      return safe
        ? setMark(schema.marks['textStyle'], { backgroundColor: safe })(state, dispatch)
        : false;
    },

    /**
     * Clear the background color.
     */
    unsetBackgroundColor: () => unsetMark(schema.marks['textStyle'], ['backgroundColor']),
  }),
});
