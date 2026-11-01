/**
 * An element's inline style read off the `style` attribute's own text —
 * never through an engine's CSSOM, which reads a shorthand differently from
 * engine to engine (jsdom drops a whole attribute over one `background:`
 * shorthand it cannot parse) — so a box reads the same wherever it runs.
 * {@link inlineBox} reads a box off the text regardless of how it was
 * written. Nothing here rewrites a style: the markup stays as written.
 */

import { Declaration, parseDeclarations } from '@h-k-dev/dawn';

// The style-text parser is Dawn's (style-text.ts there): one reading of a
// style attribute for the editor and the render engine alike.
export { parseDeclarations };
export type { Declaration };

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

/** A padding's four sides, as the CSSOM spells them. */
export function paddingSides(padding: string): string[] {
  const probe = document.createElement('div');
  probe.style.padding = padding;
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = probe.style;
  return [paddingTop, paddingRight, paddingBottom, paddingLeft].map((side) => side || '0px');
}

/** Four sides as one padding, as `parsePadding` normalises it. */
export function paddingOf(...sides: string[]): string {
  const probe = document.createElement('div');
  probe.style.padding = sides.join(' ');
  return probe.style.padding;
}

/** Whether a declared side is a zero (`0`, `0px`, `0em`, `0%`). */
export function isZeroSide(side: string): boolean {
  return /^0(?:px|em|rem|%)?$/i.test(side.trim());
}

/** Whether an element says, inline, that it has no space above — its top
    margin declared (`margin` or `margin-top`, the later winning) and zero.
    One that says nothing had a client's default space above it. What marks
    a heading or a list as **layout**: flush, its spacing left to the layout
    around it. */
export function declaresFlushTop(el: Element): boolean {
  const top = parseDeclarations(el.getAttribute('style') ?? '')
    .filter(({ name }) => name === 'margin' || name === 'margin-top')
    .at(-1);
  if (!top) return false;
  return isZeroSide(top.name === 'margin' ? top.value.trim().split(/\s+/)[0] : top.value);
}
