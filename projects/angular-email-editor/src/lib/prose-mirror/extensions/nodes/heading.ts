import { setBlockType } from 'prosemirror-commands';
import { textblockTypeInputRule } from 'prosemirror-inputrules';
import { defineNode } from '../../extension';

const LEVELS = [1, 2, 3, 4, 5, 6];

export const Heading = defineNode({
  name: 'heading',
  spec: {
    attrs: { level: { default: 1 } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: LEVELS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => [`h${node.attrs['level']}`, 0],
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
