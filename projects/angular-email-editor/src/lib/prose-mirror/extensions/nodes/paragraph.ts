import { guarded } from '../guarded';
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
    setParagraph: () => guarded(setBlockType(schema.nodes['paragraph'])),
  }),
  keymap: ({ schema }) => ({
    'Mod-Alt-0': guarded(setBlockType(schema.nodes['paragraph'])),
  }),
  actions: ({ schema }) => [
    {
      id: 'text',
      section: 'blocks',
      title: 'Text',
      keywords: ['paragraph', 'plain'],
      icon: 'notes',
      command: guarded(setBlockType(schema.nodes['paragraph'])),
    },
  ],
});
