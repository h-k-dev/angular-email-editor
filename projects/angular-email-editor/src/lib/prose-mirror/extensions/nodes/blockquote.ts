import { lift, wrapIn } from 'prosemirror-commands';
import { wrappingInputRule } from 'prosemirror-inputrules';
import { isNodeActive } from '../../editor';
import { defineNode } from '../../extension';

/** The ledger's answer to reply chains whose margins stack until text is one
    word per line: a small fixed indent and a rule, no margins at all — each
    nesting level costs 14px, never more. The grey is the divider's, safe
    against both white and near-black (the dual-contrast rule). */
export const BLOCKQUOTE_STYLE =
  'margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);';

export const Blockquote = defineNode({
  name: 'blockquote',
  spec: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', { style: BLOCKQUOTE_STYLE }, 0],
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
  actions: ({ schema }) => [
    {
      id: 'quote',
      section: 'blocks',
      title: 'Quote',
      keywords: ['blockquote', 'citation'],
      icon: 'format_quote',
      // A toggle: on a quote it lifts the text back out, anywhere else it
      // wraps — what a button does, and what a second "/quote" should.
      command: (state, dispatch, view) =>
        isNodeActive(state, schema.nodes['blockquote'])
          ? lift(state, dispatch)
          : wrapIn(schema.nodes['blockquote'])(state, dispatch, view),
      isActive: (state) => isNodeActive(state, schema.nodes['blockquote']),
    },
  ],
});
