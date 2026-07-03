import { lift, wrapIn } from 'prosemirror-commands';
import { wrappingInputRule } from 'prosemirror-inputrules';
import { defineNode } from '../../extension';

export const Blockquote = defineNode({
  name: 'blockquote',
  spec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },
  commands: ({ schema }) => ({
    wrapInBlockquote: () => wrapIn(schema.nodes['blockquote']),
    liftBlock: () => lift,
  }),
  keymap: ({ schema }) => ({
    'Ctrl->': wrapIn(schema.nodes['blockquote']),
  }),
  inputRules: ({ schema }) => [
    // `> ` at the start of a block wraps it in a blockquote.
    wrappingInputRule(/^\s*>\s$/, schema.nodes['blockquote']),
  ],
  slashItems: ({ schema }) => [
    {
      title: 'Quote',
      keywords: ['blockquote', 'citation'],
      icon: 'format_quote',
      command: wrapIn(schema.nodes['blockquote']),
    },
  ],
});
