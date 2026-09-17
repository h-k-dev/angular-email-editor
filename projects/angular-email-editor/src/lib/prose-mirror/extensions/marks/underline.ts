import { isMarkActive } from '../../editor';
import { defineMark } from '../../extension';
import { setMark } from './set.utils';
import { toggleMark } from './toggle.utils';
import { unsetMark } from './unset.utils';

export const Underline = defineMark({
  name: 'underline',
  spec: {
    parseDOM: [
      { tag: 'u' },
      {
        style: 'text-decoration',
        consuming: false,
        getAttrs: (style) => (style.includes('underline') ? {} : false),
      },
    ],
    toDOM: () => ['u', { style: 'text-decoration: underline;' }, 0],
  },
  commands: ({ schema }) => ({
    setUnderline: () => setMark(schema.marks['underline']),
    unsetUnderline: () => unsetMark(schema.marks['underline']),
    toggleUnderline: () => toggleMark(schema.marks['underline']),
  }),
  keymap: ({ schema }) => ({
    'Mod-u': toggleMark(schema.marks['underline']),
    'Mod-U': toggleMark(schema.marks['underline']),
  }),
  actions: ({ schema }) => [
    {
      id: 'underline',
      title: 'Underline',
      keywords: ['underline'],
      icon: 'format_underlined',
      command: toggleMark(schema.marks['underline']),
      isActive: (state) => isMarkActive(state, schema.marks['underline']),
    },
  ],
});
