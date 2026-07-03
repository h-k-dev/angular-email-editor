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
    },
    // Don't let a color span bleed onto the next line on Shift-Enter.
    splittable: false,
    parseDOM: [
      {
        tag: 'span',
        getAttrs: (node) => {
          const color = isSafeColor(node.style?.color) ? node.style.color : null;
          const fontSize = parseFontSize(node.style?.fontSize);
          const backgroundColor = isSafeColor(node.style?.backgroundColor)
            ? node.style.backgroundColor
            : null;
          if (!color && !fontSize && !backgroundColor) return false;
          return { color, fontSize, backgroundColor };
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
      const { color, fontSize, backgroundColor } = mark.attrs;
      const style = [
        color ? `color: ${color}` : null,
        fontSize ? `font-size: ${fontSize}px` : null,
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
