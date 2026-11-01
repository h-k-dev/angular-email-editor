/**
 * The shapes a section is read by — what a cell holds: a block of its own,
 * a column, a padding (section.ts).
 */
import { inlinePadding, isZeroSide } from '../../inline-style';

const BLOCK_TAGS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'hr',
  'section',
  'article',
  'header',
  'footer',
]);

/** Whether an element lays out as a block — a column, a paragraph, a
    table — as against a run of a line (a link, an image, a span). */
export function isBlock(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName.toLowerCase());
}

/** Whether a cell holds a block of its own — what a section's does, as
    against a button's wrapper (one anchor) or an image's (one `<img>`). */
export function holdsBlock(cell: Element): boolean {
  return Array.from(cell.children).some(isBlock);
}

/** Whether a cell declares a padding that is not all zeros. */
export function isPadded(cell: Element): boolean {
  const sides = inlinePadding(cell);
  return !!sides && sides.some((side) => !isZeroSide(side));
}

/** Whether a cell holds a column — a builder's inline-block div, or our
    own centring div — which is what a section's cell holds. */
export function holdsColumn(cell: Element): boolean {
  return Array.from(cell.children).some(
    (child) =>
      child.tagName === 'DIV' &&
      (/inline-block/i.test((child as HTMLElement).style.display) ||
        !!(child as HTMLElement).style.maxWidth),
  );
}
