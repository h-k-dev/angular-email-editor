import { setBlockType } from 'prosemirror-commands';
import { defineNode } from '../../extension';

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function hasBlockChildren(node: HTMLElement) {
  for (const child of node.children) {
    if (BLOCK_TAGS.has(child.tagName)) return true;
  }

  return false;
}

/**
 * Email flavour of the paragraph. Mail clients render the default margins of
 * `<p>` as double spacing, so email bodies use `<div>` lines instead — the
 * same model contenteditable composers (Gmail, Outlook) produce natively.
 */
export const EmailParagraph = defineNode({
  name: 'paragraph',
  spec: {
    content: 'inline*',
    group: 'block',
    parseDOM: [
      { tag: 'p' },
      // Divs holding inline content are lines. Container divs do not match,
      // so the parser descends into their children instead.
      { tag: 'div', getAttrs: (node) => !hasBlockChildren(node) && null },
    ],
    toDOM: () => ['div', { dir: 'auto' }, 0],
    // Serialization-only override (see serializeToHTML): empty lines must be
    // emitted as <div><br></div> or mail clients collapse them. The editor
    // view keeps the plain content hole — it needs it for cursor placement.
    emitDOM: (node: { childCount: number }) =>
      node.childCount === 0 ? ['div', ['br']] : ['div', 0],
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
