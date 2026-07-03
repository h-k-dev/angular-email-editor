import {
  liftListItem,
  sinkListItem,
  splitListItem as pmSplitListItem,
  wrapInList,
} from 'prosemirror-schema-list';
import { wrappingInputRule } from 'prosemirror-inputrules';
import { Command } from 'prosemirror-state';
import { NodeType, ResolvedPos } from 'prosemirror-model';
import { defineNode } from '../../extension';

/** Depth of the innermost list wrapping the selection start, or null. */
const findListDepth = ($from: ResolvedPos): number | null => {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec.content?.startsWith('listItem')) return depth;
  }
  return null;
};

/**
 * Wraps the selection in a list, lifts out of it when already in that list,
 * or converts the list in place when it is of the other flavour.
 */
export const toggleList =
  (listType: NodeType, itemType: NodeType): Command =>
  (state, dispatch, view) => {
    const { $from } = state.selection;
    const depth = findListDepth($from);
    if (depth === null) return wrapInList(listType)(state, dispatch);
    if ($from.node(depth).type === listType) return liftListItem(itemType)(state, dispatch, view);
    dispatch?.(state.tr.setNodeMarkup($from.before(depth), listType));
    return true;
  };

/**
 * Tiptap-inspired helper: Intercepts the default splitListItem transaction
 * and ensures marks (bold, italic, etc.) are carried over to the new list item.
 */
export const splitListItemKeepMarks =
  (itemType: NodeType): Command =>
  (state, dispatch, view) => {
    return pmSplitListItem(itemType)(
      state,
      (tr) => {
        const marks =
          state.storedMarks || (state.selection.$to.parentOffset && state.selection.$from.marks());

        if (marks) {
          tr.ensureMarks(marks);
        }

        dispatch?.(tr);
      },
      view,
    );
  };

export const ListItem = defineNode({
  name: 'listItem',
  spec: {
    content: 'paragraph block*',
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },
  // These return false outside a list, so they fall through to the base keymap.
  keymap: ({ schema }) => ({
    // Use the custom mark-preserving split command here
    Enter: splitListItemKeepMarks(schema.nodes['listItem']),
    Tab: sinkListItem(schema.nodes['listItem']),
    'Shift-Tab': liftListItem(schema.nodes['listItem']),
  }),
});

export const BulletList = defineNode({
  name: 'bulletList',
  spec: {
    content: 'listItem+',
    group: 'block list',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },
  commands: ({ schema }) => ({
    toggleBulletList: () => toggleList(schema.nodes['bulletList'], schema.nodes['listItem']),
  }),
  keymap: ({ schema }) => ({
    'Shift-Ctrl-8': toggleList(schema.nodes['bulletList'], schema.nodes['listItem']),
  }),
  inputRules: ({ schema }) => [
    // `- `, `* ` or `+ ` at the start of a block becomes a bullet list.
    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes['bulletList']),
  ],
  slashItems: ({ schema }) => [
    {
      title: 'Bulleted list',
      keywords: ['ul', 'unordered', 'list'],
      icon: 'format_list_bulleted',
      command: toggleList(schema.nodes['bulletList'], schema.nodes['listItem']),
    },
  ],
});

export const OrderedList = defineNode({
  name: 'orderedList',
  spec: {
    attrs: { order: { default: 1 } },
    content: 'listItem+',
    group: 'block list',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (node) => ({
          order: node.hasAttribute('start') ? +node.getAttribute('start')! : 1,
        }),
      },
    ],
    toDOM: (node) =>
      node.attrs['order'] === 1 ? ['ol', 0] : ['ol', { start: node.attrs['order'] }, 0],
  },
  commands: ({ schema }) => ({
    toggleOrderedList: () => toggleList(schema.nodes['orderedList'], schema.nodes['listItem']),
  }),
  keymap: ({ schema }) => ({
    'Shift-Ctrl-9': toggleList(schema.nodes['orderedList'], schema.nodes['listItem']),
  }),
  inputRules: ({ schema }) => [
    // `1. ` at the start of a block becomes an ordered list starting there.
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes['orderedList'],
      (match) => ({ order: +match[1] }),
      (match, node) => node.childCount + node.attrs['order'] === +match[1],
    ),
  ],
  slashItems: ({ schema }) => [
    {
      title: 'Numbered list',
      keywords: ['ol', 'ordered', 'list'],
      icon: 'format_list_numbered',
      command: toggleList(schema.nodes['orderedList'], schema.nodes['listItem']),
    },
  ],
});
