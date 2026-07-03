import { setBlockType } from 'prosemirror-commands';
import { defineNode } from '../../extension';

export const Paragraph = defineNode({
  name: 'paragraph',
  spec: {
    content: 'inline*',
    group: 'block',
    parseDOM: [
      {
        tag: 'p',
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) {
            return false;
          }

          return {};
        },
      },
    ],
    toDOM: () => ['p', { dir: 'auto' }, 0],
  },
  commands: ({ schema }) => ({
    setParagraph: () => setBlockType(schema.nodes['paragraph']),
  }),
  keymap: ({ schema }) => ({
    'Mod-Alt-0': setBlockType(schema.nodes['paragraph']),
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Text',
      keywords: ['paragraph', 'plain'],
      icon: 'notes',
      command: setBlockType(schema.nodes['paragraph']),
    },
  ],
});
