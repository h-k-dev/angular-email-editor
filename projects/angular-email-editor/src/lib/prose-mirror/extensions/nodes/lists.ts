import {
  liftListItem,
  sinkListItem,
  splitListItem as pmSplitListItem,
  wrapInList,
} from 'prosemirror-schema-list';
import { wrappingInputRule } from 'prosemirror-inputrules';
import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { NodeType, ResolvedPos } from 'prosemirror-model';
import { isNodeActive } from '../../editor';
import { defineNode } from '../../extension';
import { declaresFlushTop } from '../../inline-style';

/** Depth of the innermost list wrapping the selection start, or null. */
export const findListDepth = ($from: ResolvedPos): number | null => {
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
    const list = $from.node(depth);
    if (list.type === listType) return liftListItem(itemType)(state, dispatch, view);
    // The other flavour, in place: a layout list stays one.
    dispatch?.(
      state.tr.setNodeMarkup($from.before(depth), listType, { layout: list.attrs['layout'] }),
    );
    return true;
  };

/**
 * The layout list's toggle: wraps the selection in a layout list, makes the
 * list it is in one (either flavour, kept flush), or lifts out of it when it
 * is one already.
 */
export const toggleLayoutList =
  (listType: NodeType, itemType: NodeType): Command =>
  (state, dispatch, view) => {
    const { $from } = state.selection;
    const depth = findListDepth($from);
    if (depth === null) return wrapInList(listType, { layout: true })(state, dispatch);
    const list = $from.node(depth);
    if (list.type === listType && list.attrs['layout']) {
      return liftListItem(itemType)(state, dispatch, view);
    }
    dispatch?.(
      state.tr.setNodeMarkup($from.before(depth), listType, { ...list.attrs, layout: true }),
    );
    return true;
  };

/** Whether the selection is in a list of `type`, a layout one or not. */
const inList = (state: EditorState, type: NodeType, layout: boolean): boolean =>
  isNodeActive(state, type, { layout });

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

/** The space above and below a list: Gmail's own. */
export const LIST_SPACE = 12;

/**
 * A list's canonical inline style. The indent is the ledger's answer to the
 * 40px-per-level default that eats a third of a phone screen: 24px, nested
 * lists compounding it, readable at 320px. A list keeps 12px above and below
 * — Gmail's spacing, the margins the schema writes besides a heading's
 * (positive px margins render in Gmail, Outlook's Word engine and Apple Mail
 * alike; where one meets a heading's or another list's, Outlook may add the
 * two, up to 12px past what a browser shows). A **layout** list sits flush,
 * `margin: 0`, spacing left to the layout around it — and so does every
 * nested list, which belongs to its item's line (see {@link listRepair}).
 */
export const listStyle = (layout = false): string =>
  `margin: ${layout ? '0px' : `${LIST_SPACE}px 0px`}; padding-left: 24px;`;

/** Whether a parsed list is a layout list: written flush (the composer's own
    before lists were spaced, a builder's reset), or nested in another. */
const parsedLayout = (dom: HTMLElement): boolean =>
  declaresFlushTop(dom) || !!dom.parentElement?.closest('li, ul, ol');

/** Ranges a run of transactions wrote, in the last document's positions. */
const writtenRanges = (trs: readonly Transaction[]): [number, number][] => {
  let ranges: [number, number][] = [];
  for (const tr of trs) {
    for (const map of tr.mapping.maps) {
      ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd > newStart) ranges.push([newStart, newEnd]);
      });
    }
  }
  return ranges;
};

/**
 * Keeps a nested list flush: Tab makes one with the default attrs, and its
 * margin would push the sub-items off their parent's line. Only what the
 * transactions wrote is looked at; a nested list is made layout, never back.
 */
const listRepair = () =>
  new Plugin({
    key: new PluginKey('listRepair'),
    appendTransaction: (transactions, _old, state) => {
      if (!transactions.some((tr) => tr.docChanged)) return undefined;
      const tr = state.tr;
      const end = state.doc.content.size;
      for (const [from, to] of writtenRanges(transactions)) {
        state.doc.nodesBetween(Math.min(from, end), Math.min(to, end), (node, pos, parent) => {
          if (node.isTextblock) return false;
          const nested = parent?.type.name === 'listItem';
          if (nested && node.type.spec.group?.includes('list') && !node.attrs['layout']) {
            tr.setNodeAttribute(pos, 'layout', true);
          }
          return true;
        });
      }
      return tr.docChanged ? tr : undefined;
    },
  });

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
    attrs: {
      /** Flush, without the space around it — see {@link listStyle}. */
      layout: { default: false },
    },
    content: 'listItem+',
    group: 'block list',
    parseDOM: [{ tag: 'ul', getAttrs: (dom: HTMLElement) => ({ layout: parsedLayout(dom) }) }],
    toDOM: (node) => ['ul', { style: listStyle(node.attrs['layout'] as boolean) }, 0],
  },
  plugins: () => [listRepair()],
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
  actions: ({ schema }) => [
    {
      id: 'bulleted-list',
      section: 'blocks',
      title: 'Bulleted list',
      keywords: ['ul', 'unordered', 'list'],
      icon: 'format_list_bulleted',
      command: toggleList(schema.nodes['bulletList'], schema.nodes['listItem']),
      isActive: (state) => inList(state, schema.nodes['bulletList'], false),
    },
    {
      id: 'bulleted-list-layout',
      section: 'blocks',
      title: 'Bulleted list (layout)',
      keywords: ['ul', 'unordered', 'list', 'layout', 'flush'],
      icon: 'format_list_bulleted',
      command: toggleLayoutList(schema.nodes['bulletList'], schema.nodes['listItem']),
      isActive: (state) => inList(state, schema.nodes['bulletList'], true),
    },
  ],
});

export const OrderedList = defineNode({
  name: 'orderedList',
  spec: {
    attrs: {
      order: { default: 1 },
      /** Flush, without the space around it — see {@link listStyle}. */
      layout: { default: false },
    },
    content: 'listItem+',
    group: 'block list',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs: (node) => ({
          order: node.hasAttribute('start') ? +node.getAttribute('start')! : 1,
          layout: parsedLayout(node),
        }),
      },
    ],
    toDOM: (node) => {
      const style = listStyle(node.attrs['layout'] as boolean);
      return node.attrs['order'] === 1
        ? ['ol', { style }, 0]
        : ['ol', { start: node.attrs['order'], style }, 0];
    },
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
  actions: ({ schema }) => [
    {
      id: 'numbered-list',
      section: 'blocks',
      title: 'Numbered list',
      keywords: ['ol', 'ordered', 'list'],
      icon: 'format_list_numbered',
      command: toggleList(schema.nodes['orderedList'], schema.nodes['listItem']),
      isActive: (state) => inList(state, schema.nodes['orderedList'], false),
    },
    {
      id: 'numbered-list-layout',
      section: 'blocks',
      title: 'Numbered list (layout)',
      keywords: ['ol', 'ordered', 'list', 'layout', 'flush'],
      icon: 'format_list_numbered',
      command: toggleLayoutList(schema.nodes['orderedList'], schema.nodes['listItem']),
      isActive: (state) => inList(state, schema.nodes['orderedList'], true),
    },
  ],
});
