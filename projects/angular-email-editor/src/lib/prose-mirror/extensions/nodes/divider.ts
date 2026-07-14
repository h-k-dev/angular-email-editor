import { Command } from 'prosemirror-state';
import { defineNode } from '../../extension';

/** A block-level rule. Ledger row: horizontal rule → `width: 100%`, done —
    no fixed pixel width to overflow a phone. Colour is a faint neutral line,
    not text, so it is exempt from the dual-contrast rule. */
export const Divider = defineNode({
  name: 'divider',
  spec: {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    parseDOM: [{ tag: 'hr' }],
    // A filled 1px bar, styled with pure longhand properties and an rgb()
    // colour only. Shorthands (`border`, `border-width`, `margin`) are
    // avoided on purpose: the CSSOM re-serializes them non-deterministically
    // across engines — jsdom even *reorders* `border-width` vs Chrome — which
    // would break canonical stability. Longhands keep their insertion order
    // everywhere.
    toDOM: () => [
      'hr',
      {
        style:
          'height: 1px; width: 100%; background-color: rgb(224, 224, 224); ' +
          'margin-top: 12px; margin-bottom: 12px;',
      },
    ],
  },
  commands: ({ schema }) => ({
    insertDivider: (): Command => (state, dispatch) => {
      dispatch?.(state.tr.replaceSelectionWith(schema.nodes['divider'].create()).scrollIntoView());
      return true;
    },
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Divider',
      keywords: ['divider', 'separator', 'rule', 'hr', 'line'],
      icon: 'horizontal_rule',
      command: (state, dispatch) => {
        dispatch?.(
          state.tr.replaceSelectionWith(schema.nodes['divider'].create()).scrollIntoView(),
        );
        return true;
      },
    },
  ],
});
