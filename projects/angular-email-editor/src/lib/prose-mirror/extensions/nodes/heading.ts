import { Command } from 'prosemirror-state';
import { NodeType } from 'prosemirror-model';
import { setBlockType } from 'prosemirror-commands';
import { textblockTypeInputRule } from 'prosemirror-inputrules';
import { defineNode } from '../../extension';
import { isZeroSide, parseDeclarations } from '../../inline-style';

/** The levels the schema knows. No h5 or h6: an imported one is a plain
    line, and `##### ` stays the text it is. */
export const HEADING_LEVELS = [1, 2, 3, 4] as const;

/** The ledger's conservative scale: reads at 320px and on a desktop alike. */
export const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 20, 3: 18, 4: 16 };

/** The space above a heading, by level: its size less {@link HEADING_SPACE_BELOW}. */
export const HEADING_SPACE_ABOVE: Record<number, number> = { 1: 20, 2: 16, 3: 14, 4: 12 };

/** The space below every heading. */
export const HEADING_SPACE_BELOW = 4;

/**
 * A heading's canonical inline style. A heading sits nearer the words it
 * opens than the words before it (proximity): a margin above, a small one
 * below — the margins the schema writes (an exception to principle 3, for
 * headings only). Positive px margins render in Gmail, Outlook's Word engine
 * and Apple Mail alike (caniemail, 2026-09). Body lines carry none, so a
 * heading's margin meets another only heading-to-heading, where a browser
 * collapses the pair and Word may add it: the space below is one constant
 * 4px, and the space above is the size less it, so Outlook's worst case
 * lands on the size itself (24/20/18/16) and is never more than 4px off. A
 * **layout** heading — a band's title, a column's — sits flush: `margin: 0`,
 * spacing left to the layout around it. No `line-height` — Outlook
 * substitutes its own (the client-support module says so) and our output
 * stays lint-clean. Incoming heading styles never survive: the scale is the
 * schema's, not the author's.
 */
export const headingStyle = (level: number, layout = false): string => {
  const size = HEADING_SIZES[level] ?? 16;
  const above = HEADING_SPACE_ABOVE[level] ?? size - HEADING_SPACE_BELOW;
  const margin = layout ? '0px' : `${above}px 0px ${HEADING_SPACE_BELOW}px`;
  return `margin: ${margin}; font-size: ${size}px;`;
};

/** A heading written flush — its top margin said, and zero — is a layout
    heading: the composer's own before headings were spaced, a builder's
    reset title. One that says nothing had a client's default space above
    it, and keeps space. */
const isLayout = (el: HTMLElement): boolean => {
  const top = parseDeclarations(el.getAttribute('style') ?? '')
    .filter(({ name }) => name === 'margin' || name === 'margin-top')
    .at(-1);
  if (!top) return false;
  return isZeroSide(top.name === 'margin' ? top.value.trim().split(/\s+/)[0] : top.value);
};

/** Makes the line a heading of `level`; a layout heading when `layout`. */
const toHeading = (type: NodeType, level: number, layout = false): Command =>
  setBlockType(type, { level, layout });

/** Makes the line a layout heading, at its level when it is a heading
    already, else at 1. */
const toLayoutHeading =
  (type: NodeType): Command =>
  (state, dispatch, view) => {
    const { $from } = state.selection;
    const level = $from.parent.type === type ? ($from.parent.attrs['level'] as number) : 1;
    return toHeading(type, level, true)(state, dispatch, view);
  };

export const Heading = defineNode({
  name: 'heading',
  spec: {
    attrs: {
      level: { default: 1 },
      /** Flush, without the space above — see {@link headingStyle}. */
      layout: { default: false },
    },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: HEADING_LEVELS.map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom: HTMLElement) => ({ level, layout: isLayout(dom) }),
    })),
    toDOM: (node) => [
      `h${node.attrs['level']}`,
      { style: headingStyle(node.attrs['level'] as number, node.attrs['layout'] as boolean) },
      0,
    ],
  },
  commands: ({ schema }) => ({
    setHeading: (level: number, layout = false) =>
      toHeading(schema.nodes['heading'], level, layout),
    setLayoutHeading: () => toLayoutHeading(schema.nodes['heading']),
  }),
  keymap: ({ schema }) =>
    Object.fromEntries(
      HEADING_LEVELS.map((level) => [
        `Shift-Ctrl-${level}`,
        toHeading(schema.nodes['heading'], level),
      ]),
    ),
  inputRules: ({ schema }) => [
    // `## ` at the start of a block becomes an h2, up to `#### `.
    textblockTypeInputRule(/^(#{1,4})\s$/, schema.nodes['heading'], (match) => ({
      level: match[1].length,
    })),
  ],
  actions: ({ schema }) => [
    ...[1, 2, 3].map((level) => ({
      id: `heading-${level}`,
      section: 'blocks',
      title: `Heading ${level}`,
      keywords: [`h${level}`, 'title', 'heading'],
      icon: `format_h${level}`,
      command: toHeading(schema.nodes['heading'], level),
    })),
    {
      id: 'heading-layout',
      section: 'blocks',
      title: 'Heading (layout)',
      keywords: ['title', 'heading', 'layout', 'flush', 'banner'],
      icon: 'title',
      command: toLayoutHeading(schema.nodes['heading']),
    },
  ],
});
