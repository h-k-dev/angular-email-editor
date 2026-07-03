import { Node as PMNode } from 'prosemirror-model';
import { PreparedText, layout, prepare } from '@chenglou/pretext';
import {
  PreparedRichInline,
  RichInlineItem,
  measureRichInlineStats,
  prepareRichInline,
} from '@chenglou/pretext/rich-inline';

/**
 * Math-based text measurement for the editor document, built on
 * `@chenglou/pretext`. Block heights and line counts are computed from cached
 * canvas glyph widths instead of DOM reads (`offsetHeight`,
 * `getBoundingClientRect`), so measuring never triggers a layout reflow.
 */

/** Typography of the live editor surface, read from computed style once. */
export interface EditorTypography {
  fontFamily: string;
  /** Body text size in px. */
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  /** Body line height in px. */
  lineHeight: number;
  /** Vertical gap between sibling top-level blocks (`--prose-gap`), px. */
  blockGap: number;
  /** Heading font-size factors for levels 1-6, relative to the body size. */
  headingScale: readonly number[];
  /** Horizontal space consumed by wrapper blocks, px. */
  indents: {
    blockquote: number;
    list: number;
    /** Vertical gap between adjacent list items, px. */
    listItemGap: number;
  };
}

/** Browser default h1-h6 sizes; the editor stylesheet doesn't restyle them. */
const HEADING_SCALE = [2, 1.5, 1.17, 1, 0.83, 0.67] as const;

const cssPx = (style: CSSStyleDeclaration, property: string, fallback: number): number => {
  const value = parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
};

/**
 * Reads the typography pretext needs from the editor's computed style. One
 * DOM read at startup (and again once webfonts settle) — never per keystroke.
 */
export function readTypography(dom: HTMLElement): EditorTypography {
  const style = getComputedStyle(dom);
  const fontSize = parseFloat(style.fontSize) || 16;
  // `line-height: normal` parses as NaN; browsers render it at roughly 1.2.
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
  const innerSpacing = cssPx(style, '--mat-sys-inner-spacing', 16);

  return {
    fontFamily: style.fontFamily,
    fontSize,
    fontWeight: parseInt(style.fontWeight, 10) || 400,
    fontStyle: style.fontStyle,
    lineHeight,
    blockGap: cssPx(style, '--prose-gap', fontSize),
    headingScale: HEADING_SCALE,
    indents: {
      blockquote: innerSpacing + 3, // padding-inline-start + border
      list: 1.5 * fontSize, // ul/ol padding-inline-start
      listItemGap: 0.25 * fontSize, // li + li margin-block-start
    },
  };
}

export interface TextMetrics {
  words: number;
  characters: number;
  /** Wrapped line count across all text blocks at the current width. */
  lines: number;
  /**
   * Estimated rendered height of the document in px, block gaps included.
   * Text-only: atom blocks (images) contribute no height since their
   * rendered size isn't knowable without loading them.
   */
  estimatedHeight: number;
}

/**
 * Prepared measurements for one textblock. Single-font blocks (the common
 * case in email) go through `prepare()` with `pre-wrap`, matching the editor
 * CSS exactly — hard breaks become `\n` in one prepared handle. Blocks with
 * mark-dependent fonts (bold/italic) use the rich-inline API, one prepared
 * handle per hard-break segment.
 */
type PreparedBlock =
  | { kind: 'plain'; prepared: PreparedText }
  | { kind: 'rich'; segments: PreparedRichInline[] };

interface CachedBlock {
  block: PreparedBlock;
  lineHeight: number;
  words: number;
  characters: number;
  /** Line count memoised for the last width measured at. */
  lastWidth: number;
  lastLines: number;
}

/**
 * Measurement cache keyed on ProseMirror's immutable nodes: blocks untouched
 * by a transaction keep their node identity, so across keystrokes only the
 * edited block is ever re-prepared. Create one per editor view; replace it
 * wholesale to invalidate (e.g. after webfonts load).
 */
export type BlockMeasureCache = WeakMap<PMNode, CachedBlock>;

export const createBlockMeasureCache = (): BlockMeasureCache => new WeakMap();

/**
 * Measures the whole document at the given content width. Pure arithmetic
 * over cached glyph widths — no DOM access.
 */
export function measureDoc(
  doc: PMNode,
  contentWidth: number,
  typography: EditorTypography,
  cache: BlockMeasureCache,
): TextMetrics {
  const metrics: TextMetrics = { words: 0, characters: 0, lines: 0, estimatedHeight: 0 };
  const width = Math.max(contentWidth, 1);

  const visitChildren = (parent: PMNode, availableWidth: number, gap: number) => {
    let index = 0;
    parent.forEach((child) => {
      if (index++ > 0) metrics.estimatedHeight += gap;
      visit(child, availableWidth);
    });
  };

  const visit = (node: PMNode, availableWidth: number) => {
    if (node.isTextblock) {
      const measured = measureTextblock(node, availableWidth, typography, cache);
      metrics.words += measured.words;
      metrics.characters += measured.characters;
      metrics.lines += measured.lastLines;
      metrics.estimatedHeight += measured.lastLines * measured.lineHeight;
      return;
    }

    switch (node.type.name) {
      case 'blockquote':
        visitChildren(node, availableWidth - typography.indents.blockquote, 0);
        break;
      case 'bulletList':
      case 'orderedList':
        visitChildren(
          node,
          availableWidth - typography.indents.list,
          typography.indents.listItemGap,
        );
        break;
      default:
        // List items and future wrappers: measure content at full width.
        if (node.childCount) visitChildren(node, availableWidth, 0);
        break;
    }
  };

  visitChildren(doc, width, typography.blockGap);
  metrics.estimatedHeight = Math.round(metrics.estimatedHeight);
  return metrics;
}

function measureTextblock(
  node: PMNode,
  width: number,
  typography: EditorTypography,
  cache: BlockMeasureCache,
): CachedBlock {
  const maxWidth = Math.max(width, 1);

  let cached = cache.get(node);
  if (!cached) {
    cached = prepareBlock(node, typography);
    cache.set(node, cached);
  }

  if (cached.lastWidth !== maxWidth) {
    cached.lastLines = countLines(cached.block, maxWidth, cached.lineHeight);
    cached.lastWidth = maxWidth;
  }

  return cached;
}

function countLines(block: PreparedBlock, maxWidth: number, lineHeight: number): number {
  if (block.kind === 'plain') {
    // Browsers size an empty block to one line-height; pretext reports 0.
    return Math.max(1, layout(block.prepared, maxWidth, lineHeight).lineCount);
  }
  return block.segments.reduce(
    (lines, segment) => lines + Math.max(1, measureRichInlineStats(segment, maxWidth).lineCount),
    0,
  );
}

interface BlockFont {
  size: number;
  weight: number;
  style: string;
  lineHeight: number;
}

function blockFontFor(node: PMNode, t: EditorTypography): BlockFont {
  if (node.type.name === 'heading') {
    const level: number = node.attrs['level'] ?? 1;
    const size = t.fontSize * (t.headingScale[level - 1] ?? 1);
    return {
      size,
      weight: 700,
      style: t.fontStyle,
      lineHeight: size * (t.lineHeight / t.fontSize),
    };
  }
  return { size: t.fontSize, weight: t.fontWeight, style: t.fontStyle, lineHeight: t.lineHeight };
}

/** Canvas `font` shorthand, the format pretext's `prepare()` expects. */
const fontShorthand = (style: string, weight: number, size: number, family: string): string =>
  `${style === 'normal' ? '' : `${style} `}${weight} ${size}px ${family}`;

function prepareBlock(node: PMNode, typography: EditorTypography): CachedBlock {
  const base = blockFontFor(node, typography);
  const baseFont = fontShorthand(base.style, base.weight, base.size, typography.fontFamily);

  // Inline runs split on hard breaks; each segment lays out as its own line(s).
  const segments: RichInlineItem[][] = [[]];
  let words = 0;
  let characters = 0;
  let mixedFonts = false;

  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      segments.push([]);
      return;
    }
    if (!child.isText || !child.text) return;

    const bold = child.marks.some((mark) => mark.type.name === 'bold');
    const italic = child.marks.some((mark) => mark.type.name === 'italic');
    const font =
      bold || italic
        ? fontShorthand(
            italic ? 'italic' : base.style,
            bold ? 700 : base.weight,
            base.size,
            typography.fontFamily,
          )
        : baseFont;

    if (font !== baseFont) mixedFonts = true;
    segments[segments.length - 1].push({ text: child.text, font });
    words += child.text.split(/\s+/).filter(Boolean).length;
    characters += child.text.length;
  });

  const block: PreparedBlock = mixedFonts
    ? {
        kind: 'rich',
        segments: segments.map((runs) => prepareRichInline(runs)),
      }
    : {
        // Single font: `prepare()` with pre-wrap mirrors the editor CSS
        // exactly, and hard breaks fold into the text as `\n`.
        kind: 'plain',
        prepared: prepare(
          segments.map((runs) => runs.map((run) => run.text).join('')).join('\n'),
          baseFont,
          { whiteSpace: 'pre-wrap' },
        ),
      };

  return { block, lineHeight: base.lineHeight, words, characters, lastWidth: -1, lastLines: 0 };
}
