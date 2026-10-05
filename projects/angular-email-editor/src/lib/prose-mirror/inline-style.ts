/**
 * An element's inline style read off the `style` attribute's own text,
 * and the normalisation that lets every engine's CSSOM read it the same.
 *
 * The import reads a builder's styles through the CSSOM where it can —
 * the engine expands a shorthand, prints a colour one way — and the
 * canonical form must come out the same wherever the import runs: the
 * replica the editor shows is what is sent, and the replica files the
 * unit suite writes under jsdom must be what a browser makes. jsdom's
 * CSSOM is not a browser's:
 *
 * - a `background:` shorthand it cannot parse (MJML's `background:#fff`,
 *   a `background:url(…) center / cover no-repeat`) makes it drop the
 *   **whole** attribute — display, colour, size, padding and all;
 * - a `padding`/`margin` longhand written after the shorthand
 *   (`padding:0px;padding-top:20px`) is dropped, the shorthand kept.
 *
 * {@link normalizeInlineStyles} rewrites exactly those two shapes into
 * declarations every engine parses alike (the longhands of a background,
 * one four-value shorthand for a box), leaving every other declaration
 * as authored; {@link inlineBox} reads a box off the text regardless.
 */

export interface Declaration {
  name: string;
  value: string;
  important: boolean;
}

/** A style attribute's declarations: split on `;` outside parentheses and
    quotes (a `url(data:…;base64,…)` holds one), names lower-cased,
    `!important` lifted off the value. Empty and nameless parts dropped. */
export function parseDeclarations(style: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const text of splitDeclarations(style)) {
    const colon = text.indexOf(':');
    if (colon < 0) continue;
    const name = text.slice(0, colon).trim().toLowerCase();
    let value = text.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    if (!name || !value) continue;
    declarations.push({ name, value, important });
  }
  return declarations;
}

function splitDeclarations(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (quote) {
      if (ch === quote && style[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      parts.push(style.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(style.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The four sides of a box as written (`20px`, `0`, `auto`), top right
    bottom left — or null where the element declares none. The cascade's
    reading: a shorthand sets all four, a longhand its one, later wins; a
    longhand alone leaves the other sides `0`. */
export type BoxSides = [string, string, string, string];

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function inlineBox(el: Element, property: 'padding' | 'margin'): BoxSides | null {
  const style = el.getAttribute('style');
  if (!style) return null;
  return boxOf(parseDeclarations(style), property);
}

function boxOf(declarations: Declaration[], property: 'padding' | 'margin'): BoxSides | null {
  let sides: BoxSides | null = null;
  for (const { name, value } of declarations) {
    if (name === property) {
      const parts = value.split(/\s+/);
      if (parts.length > 4) continue;
      const [t, r = t, b = t, l = r] = parts;
      sides = [t, r, b, l];
    } else if (name.startsWith(`${property}-`)) {
      const index = SIDES.indexOf(name.slice(property.length + 1) as (typeof SIDES)[number]);
      if (index < 0) continue;
      sides ??= ['0', '0', '0', '0'];
      sides[index] = value;
    }
  }
  return sides;
}

/** The padding an element declares inline — see {@link inlineBox}. */
export const inlinePadding = (el: Element): BoxSides | null => inlineBox(el, 'padding');

/** Whether a declared side is a zero (`0`, `0px`, `0em`, `0%`). */
export function isZeroSide(side: string): boolean {
  return /^0(?:px|em|rem|%)?$/i.test(side.trim());
}

/**
 * Rewrites, under `root`, every `style` attribute whose text an engine
 * might read wrong — see the module note — into the same declarations in
 * longhand or one shorthand. An attribute with neither shape is left as
 * authored, to the character.
 */
export function normalizeInlineStyles(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const authored = el.getAttribute('style') ?? '';
    const normalized = normalizeStyleText(authored);
    if (normalized !== null) el.setAttribute('style', normalized);
  }
}

/** The normalised text, or null when the authored text needs no change. */
export function normalizeStyleText(style: string): string | null {
  const declarations = parseDeclarations(style);
  const hasBackgroundShorthand = declarations.some((d) => d.name === 'background');
  const mixed = (property: 'padding' | 'margin') =>
    declarations.some((d) => d.name === property) &&
    declarations.some((d) => d.name.startsWith(`${property}-`));
  const mixedPadding = mixed('padding');
  const mixedMargin = mixed('margin');
  if (!hasBackgroundShorthand && !mixedPadding && !mixedMargin) return null;

  const out: string[] = [];
  const boxWritten = { padding: false, margin: false };
  const print = (name: string, value: string, important: boolean) =>
    out.push(`${name}: ${value}${important ? ' !important' : ''}`);
  for (const { name, value, important } of declarations) {
    if (name === 'background') {
      for (const [longhand, part] of expandBackground(value)) print(longhand, part, important);
      continue;
    }
    const box = (['padding', 'margin'] as const).find(
      (property) => name === property || name.startsWith(`${property}-`),
    );
    if (box && (box === 'padding' ? mixedPadding : mixedMargin)) {
      // The resolved box once, where its first declaration stood; the
      // `!important` of any of them carries.
      if (boxWritten[box]) continue;
      boxWritten[box] = true;
      const sides = boxOf(declarations, box)!;
      const anyImportant = declarations.some(
        (d) => (d.name === box || d.name.startsWith(`${box}-`)) && d.important,
      );
      print(box, sides.join(' '), anyImportant);
      continue;
    }
    print(name, value, important);
  }
  return `${out.join('; ')};`;
}

const REPEAT = /^(?:repeat|repeat-x|repeat-y|no-repeat|space|round)$/i;
const SIZE = /^(?:cover|contain|auto)$/i;
const POSITION = /^(?:left|right|top|bottom|center|-?\d+(?:\.\d+)?(?:px|%|em|rem)?)$/i;
const DROPPED = /^(?:scroll|fixed|local|border-box|padding-box|content-box|none)$/i;
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(.*\)|[a-z]+)$/i;

/**
 * A `background` shorthand's parts as longhands, in a fixed order: the
 * image (a `url(…)`), the colour, the repeat, the position, the size
 * (what follows a `/`). One layer; attachment, origin and clip are
 * dropped — no email reads them. A bare word that is no keyword is the
 * colour (`white`).
 */
function expandBackground(value: string): [name: string, value: string][] {
  const longhands: [string, string][] = [];
  let color: string | null = null;
  let repeat: string | null = null;
  const position: string[] = [];
  const size: string[] = [];
  // After a `/` the size tokens follow; the first token that is no size
  // (`no-repeat`) is back in the shorthand's general run.
  let inSize = false;
  for (const token of tokens(value)) {
    if (token === '/') {
      inSize = true;
      continue;
    }
    if (inSize && (SIZE.test(token) || LENGTH.test(token))) {
      size.push(token);
      continue;
    }
    inSize = false;
    if (/^url\(/i.test(token)) longhands.push(['background-image', token]);
    else if (REPEAT.test(token)) repeat = token;
    else if (POSITION.test(token)) position.push(token);
    else if (DROPPED.test(token)) continue;
    else if (COLOR.test(token)) color = token;
  }
  if (color) longhands.push(['background-color', color]);
  if (repeat) longhands.push(['background-repeat', repeat]);
  if (position.length) longhands.push(['background-position', position.join(' ')]);
  if (size.length) longhands.push(['background-size', size.join(' ')]);
  return longhands;
}

const LENGTH = /^-?\d+(?:\.\d+)?(?:px|%|em|rem)?$/;

/** Whitespace-separated tokens, a parenthesised one (`url(a b)`,
    `rgb(1, 2, 3)`) kept whole, a `/` a token of its own (`top/cover`). */
function tokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  const flush = () => {
    if (current) out.push(current);
    current = '';
  };
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0 && /\s/.test(ch)) {
      flush();
    } else if (depth === 0 && ch === '/') {
      flush();
      out.push('/');
    } else current += ch;
  }
  flush();
  return out;
}
