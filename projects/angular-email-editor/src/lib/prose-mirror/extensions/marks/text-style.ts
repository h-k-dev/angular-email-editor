import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { defineMark } from '../../extension';
import { fillTextColor, isFillTextColor } from '../../dual-contrast';
import { setMark } from './set.utils';
import { unsetMark } from './unset.utils';
import {
  FontSize,
  allowedFontSizes,
  isEmailFontStack,
  matchEmailFont,
} from '@h-k-dev/angular-email-editor/fonts';

/**
 * Allow only color values that can't smuggle extra declarations into the
 * `style` attribute: hex, rgb[a]/hsl[a] functional notation, or a bare CSS
 * named color. Mirrors the security-consciousness of the link mark's
 * `isSafeUrl`. `node.style.color` is already normalised by the browser's
 * CSSOM, but the legacy `<font color>` path and the programmatic `setColor`
 * command take raw strings, so we gate both.
 */
export function isSafeColor(color: string | null | undefined): color is string {
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
  // A CSS-wide keyword is no colour: `initial` is what the CSSOM says for a
  // `background: url(…)` shorthand's colour, and it computes to black.
  if (
    /^(initial|inherit|unset|revert|revert-layer|transparent|currentcolor|none)$/i.test(raw.trim())
  ) {
    return null;
  }

  // Already hex — fast path. Lower-cased, as the rgb path writes it: an
  // engine that expands a builder's `background: #040B4F` shorthand hands
  // the rgb over, one that does not hands the words over, and the import
  // must come out the same in both.
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw.toLowerCase();

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

export type TextTransform = 'uppercase' | 'lowercase' | 'capitalize';

/** A `text-transform` the mark takes: the three cases; `none` and the
    rest are the words as written. */
export function parseTextTransform(raw: string | null | undefined): TextTransform | null {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'uppercase' || value === 'lowercase' || value === 'capitalize' ? value : null;
}

/** Whether the selection (or the caret's stored marks) shows in capitals. */
function isUppercase(state: EditorState, schema: Schema): boolean {
  const type = schema.marks['textStyle'];
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    return marks.some((mark) => mark.type === type && mark.attrs['textTransform'] === 'uppercase');
  }
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (found || !node.isInline) return !found;
    found = node.marks.some(
      (mark) => mark.type === type && mark.attrs['textTransform'] === 'uppercase',
    );
    return !found;
  });
  return found;
}

// The font set is its own entry, plain data a host's other composer shares;
// the main entry carries it too, as it always has.
export * from '@h-k-dev/angular-email-editor/fonts';

export function isSafeFontSize(value: unknown): value is FontSize {
  return allowedFontSizes.includes(value as FontSize);
}

/**
 * Parse a font-size value from the DOM into one of our allowed sizes.
 * Handles px strings ("16px"), plain numbers, and rejects everything else.
 */
export function parseFontSize(raw: string | null | undefined): FontSize | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0 || !/^\s*\d+(?:\.\d+)?(?:px)?\s*$/.test(raw)) return null;
  if (isSafeFontSize(n)) return n;
  // A size off the ladder — a builder's 11px, 13px, 15px — snaps to the
  // nearest rung, upward on a tie: read as the size it is nearest to, not
  // dropped to the default. (The schema still emits only its own rungs.)
  let nearest: FontSize = allowedFontSizes[0];
  for (const size of allowedFontSizes) {
    const better =
      Math.abs(size - n) < Math.abs(nearest - n) ||
      (Math.abs(size - n) === Math.abs(nearest - n) && size > nearest);
    if (better) nearest = size;
  }
  return nearest;
}

/** Whether `value` is one of the curated stacks (`@h-k-dev/angular-email-editor/fonts`). */
export function isSafeFontFamily(value: unknown): value is string {
  return isEmailFontStack(value);
}

/**
 * Parse a font-family value from the DOM into one of the curated stacks,
 * returning the *canonical* stack string (so a cosmetically different but
 * equivalent input normalises to the exact bytes we emit). A stack of
 * someone else's reads as the curated one it falls back to
 * ({@link matchEmailFont}). Nothing to fall back to, no font.
 */
export function parseFontFamily(raw: string | null | undefined): string | null {
  return matchEmailFont(raw)?.stack ?? null;
}

/**
 * TipTap-style `textStyle` mark: a `<span style="…">` container holding inline
 * text-styling attributes — `color`, `fontSize`, `fontFamily` and
 * `backgroundColor` (the highlighter). All hang off one shared span and merge
 * into a single `style` string instead of nesting wrapper tags.
 *
 * Modeled on `@tiptap/extension-text-style` + `@tiptap/extension-color`: each
 * primitive is an *attribute* on the span, not its own mark, so `setColor`,
 * `setFontSize`, … all coalesce onto the same element. `backgroundColor` fills
 * only from the curated dual-safe background palette (principle 9); a hand-typed
 * fill in the HTML source is the author's own responsibility, never policed.
 */
export const TextStyle = defineMark({
  name: 'textStyle',
  spec: {
    attrs: {
      color: { default: null },
      fontSize: { default: null },
      fontFamily: { default: null },
      backgroundColor: { default: null },
      /** `uppercase`, `lowercase` or `capitalize` — a builder's navbar and
          headings wear one; null for the words as written. */
      textTransform: { default: null },
    },
    parseDOM: [
      {
        tag: 'span',
        getAttrs: (node) => {
          let color = isSafeColor(node.style?.color) ? node.style.color : null;
          const fontSize = parseFontSize(node.style?.fontSize);
          const fontFamily = parseFontFamily(node.style?.fontFamily);
          const backgroundColor = isSafeColor(node.style?.backgroundColor)
            ? node.style.backgroundColor
            : null;
          // The paired fill text colour is an emit artifact of the fill, not
          // an authored colour — absorb it so the pair round-trips clean and
          // clearing the fill later also clears its text colour.
          if (backgroundColor && isFillTextColor(color, backgroundColor)) color = null;
          const textTransform = parseTextTransform(node.style?.textTransform);
          if (!color && !fontSize && !fontFamily && !backgroundColor && !textTransform) {
            return false;
          }
          return { color, fontSize, fontFamily, backgroundColor, textTransform };
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
      const { color, fontSize, fontFamily, backgroundColor, textTransform } = mark.attrs;
      // A fill never rides on the client's default text colour: without an
      // authored colour it carries its paired text (see fillTextColor).
      const textColor = color ?? (backgroundColor ? fillTextColor(backgroundColor) : null);
      const style = [
        textColor ? `color: ${textColor}` : null,
        fontSize ? `font-size: ${fontSize}px` : null,
        fontFamily ? `font-family: ${fontFamily}` : null,
        backgroundColor ? `background-color: ${backgroundColor}` : null,
        textTransform ? `text-transform: ${textTransform}` : null,
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
     * Set the case the words are shown in — `uppercase`, `lowercase` or
     * `capitalize` — leaving them as typed underneath.
     */
    setTextTransform: (value: TextTransform) => (state, dispatch) =>
      parseTextTransform(value)
        ? setMark(schema.marks['textStyle'], { textTransform: value })(state, dispatch)
        : false,

    /**
     * Show the words as typed again.
     */
    unsetTextTransform: () => unsetMark(schema.marks['textStyle'], ['textTransform']),

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
  actions: ({ schema }) => [
    {
      id: 'uppercase',
      section: 'styling',
      title: 'Uppercase',
      keywords: ['uppercase', 'capitals', 'caps', 'case'],
      icon: 'keyboard_capslock',
      command: (state, dispatch) =>
        isUppercase(state, schema)
          ? unsetMark(schema.marks['textStyle'], ['textTransform'])(state, dispatch)
          : setMark(schema.marks['textStyle'], { textTransform: 'uppercase' })(state, dispatch),
      isActive: (state) => isUppercase(state, schema),
    },
  ],
});
