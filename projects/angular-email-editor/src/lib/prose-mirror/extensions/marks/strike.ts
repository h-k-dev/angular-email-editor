import { toggleMark } from 'prosemirror-commands';
import { defineMark } from '../../extension';
import { setMark } from './set.utils';
import { unsetMark } from './unset.utils';

export const Strike = defineMark({
  name: 'strike',
  spec: {
    parseDOM: [
      {
        tag: 's',
      },
      {
        tag: 'del',
      },
      {
        tag: 'strike',
      },
      {
        style: 'text-decoration',
        consuming: false,
        getAttrs: (style) => ((style as string).includes('line-through') ? {} : false),
      },
    ],
    toDOM: () => ['s', { style: 'text-decoration: line-through;' }, 0],
  },
  commands: ({ schema }) => ({
    setStrike: () => setMark(schema.marks['strike']),
    unsetStrike: () => unsetMark(schema.marks['strike']),
    toggleStrike: () => toggleMark(schema.marks['strike']),
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Strike',
      keywords: ['strike', 'strikethrough'],
      icon: 'format_strikethrough',
      command: toggleMark(schema.marks['strike']),
    },
  ],
});
