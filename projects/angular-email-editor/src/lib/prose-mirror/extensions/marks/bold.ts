import { defineMark } from '../../extension';

import { setMark } from './set.utils';
import { unsetMark } from './unset.utils';
import { toggleMark } from './toggle.utils';

/** **bold** */
export const starInputRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;

/** **bold** while pasting. */
export const starPasteRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))/g;

/** __bold__ */
export const underscoreInputRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;

/** __bold__ while pasting. */
export const underscorePasteRegex = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))/g;

/**
 * Email specific html bold parsing rules.
 * Watchout for normlization against
 * - numeric font weights
 * - case-insensitive font weights
 * - inline styles resetting the weight back to normal
 * - inline styles resetting the weight back to 400
 * - inline styles resetting the weight back to normal
 * - inline styles resetting the weight back to 400
 */
export const Bold = defineMark({
  name: 'bold',
  spec: {
    parseDOM: [
      { tag: 'strong' },
      {
        /** <b> counts as bold unless inline styles reset the weight back to normal.*/
        tag: 'b',
        getAttrs: (node) => {
          if (node.style?.fontWeight === 'normal' || node.style?.fontWeight === '400') {
            return false;
          }
          return null;
        },
      },
      {
        style: 'font-weight=normal',
        clearMark: (mark) => mark.type.name === 'bold',
      },
      {
        style: 'font-weight=400',
        clearMark: (mark) => mark.type.name === 'bold',
      },
      {
        style: 'font-weight',
        // Cast value to string and use 'i' flag for case-insensitivity
        getAttrs: (value) => (/^(bold(er)?|[5-9]\d{2,})$/i.test(value as string) ? null : false),
      },
    ],
    toDOM: () => ['strong', { style: 'font-weight: bold;' }, 0],
  },
  commands: ({ schema }) => ({
    setBold: () => setMark(schema.marks['bold']),
    unsetBold: () => unsetMark(schema.marks['bold']),
    toggleBold: () => toggleMark(schema.marks['bold']),
  }),
  keymap: ({ schema }) => ({
    'Mod-b': toggleMark(schema.marks['bold']),
    'Mod-B': toggleMark(schema.marks['bold']),
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Bold',
      keywords: ['bold'],
      icon: 'format_bold',
      command: toggleMark(schema.marks['bold']),
    },
  ],
});
