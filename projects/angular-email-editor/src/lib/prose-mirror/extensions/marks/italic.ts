import { defineMark } from '../../extension';
import { setMark } from './set.utils';
import { unsetMark } from './unset.utils';
import { toggleMark } from './toggle.utils';

/** *italic* */
export const italicStarInputRegex = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;

/** *italic* while pasting. */
export const italicStarPasteRegex = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))/g;

/** _italic_ */
export const italicUnderscoreInputRegex = /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/;

/** _italic_ while pasting. */
export const italicUnderscorePasteRegex = /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))/g;

export const Italic = defineMark({
  name: 'italic',
  spec: {
    parseDOM: [
      { tag: 'em' },
      { tag: 'i', getAttrs: (node) => (node.style.fontStyle !== 'normal' ? null : false) },
      { style: 'font-style=normal', clearMark: (mark) => mark.type.name === 'italic' },
      { style: 'font-style=italic' },
    ],
    toDOM: () => ['em', { style: 'font-style: italic;' }, 0],
  },
  commands: ({ schema }) => ({
    setItalic: () => setMark(schema.marks['italic']),
    unsetItalic: () => unsetMark(schema.marks['italic']),
    toggleItalic: () => toggleMark(schema.marks['italic']),
  }),
  keymap: ({ schema }) => ({
    'Mod-i': toggleMark(schema.marks['italic']),
    'Mod-I': toggleMark(schema.marks['italic']),
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Italic',
      keywords: ['italic'],
      icon: 'format_italic',
      command: toggleMark(schema.marks['italic']),
    },
  ],
});
