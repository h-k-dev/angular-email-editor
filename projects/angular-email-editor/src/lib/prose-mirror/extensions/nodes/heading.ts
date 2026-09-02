import { setBlockType } from 'prosemirror-commands';
import { textblockTypeInputRule } from 'prosemirror-inputrules';
import { defineNode } from '../../extension';

const LEVELS = [1, 2, 3, 4, 5, 6];

/** The ledger's conservative scale: reads at 320px and on a desktop alike. */
export const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 20, 3: 18, 4: 16, 5: 16, 6: 16 };

/** A heading's canonical inline style. No margins — lines carry none
    (principle 3), spacing is an empty line; no `line-height` — Outlook
    substitutes its own (the client-support module says so) and our output
    stays lint-clean. Incoming heading styles never survive: the scale is the
    schema's, not the author's. */
export const headingStyle = (level: number): string =>
  `margin: 0px; font-size: ${HEADING_SIZES[level] ?? 16}px;`;

export const Heading = defineNode({
  name: 'heading',
  spec: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: LEVELS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [
      `h${node.attrs['level']}`,
      { style: headingStyle(node.attrs['level'] as number) },
      0,
    ],
  },
  commands: ({ schema }) => ({
    setHeading: (level: number) => setBlockType(schema.nodes['heading'], { level }),
  }),
  keymap: ({ schema }) =>
    Object.fromEntries(
      LEVELS.map((level) => [
        `Shift-Ctrl-${level}`,
        setBlockType(schema.nodes['heading'], { level }),
      ]),
    ),
  inputRules: ({ schema }) => [
    // `## ` at the start of a block becomes an h2, etc.
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes['heading'], (match) => ({
      level: match[1].length,
    })),
  ],
  slashItems: ({ schema }) =>
    [1, 2, 3].map((level) => ({
      title: `Heading ${level}`,
      keywords: [`h${level}`, 'title', 'heading'],
      icon: `format_h${level}`,
      command: setBlockType(schema.nodes['heading'], { level }),
    })),
});
