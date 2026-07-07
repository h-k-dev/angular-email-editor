import { Command } from 'prosemirror-state';
import { defineNode } from '../../extension';

/** The button's canonical styling. No `height` — the touch target comes from
    padding (≥ 44px tall, per the ledger). No `border-radius` — Outlook squares
    it anyway, and dropping it keeps our own output lint-clean. rgb() colours,
    not hex: the browser normalizes hex to rgb on the serialize round trip, so
    the canonical form must already be rgb to stay stable. */
const BUTTON_STYLE =
  'display: inline-block; padding: 14px 28px; ' +
  'background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
  'font-weight: bold; text-decoration: none;';

/**
 * A call-to-action button: a block that serializes to a padded `inline-block`
 * anchor — the email-safe "fake button" every client renders as a tappable
 * coloured box. `display: inline-block` in the style is also the parse
 * discriminator: it is what tells a button apart from an ordinary link, so the
 * two never collide on the round trip.
 *
 * It is an **atom** (label and href are attributes, not editable inline
 * content): a block node rendered as an inline `<a>` cannot hold editable
 * content safely — the browser's contentEditable ignores the node boundary and
 * unwraps it when you type. As an atom the node is an inert island; its label
 * and href are edited in the HTML source pane, the same way image alt/width
 * are. A dedicated inline editor is a future polish item.
 */
export const Button = defineNode({
  name: 'button',
  spec: {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    attrs: { href: { default: '#' }, label: { default: 'Button' } },
    parseDOM: [
      {
        tag: 'a[href]',
        // Higher than the link mark's default so an inline-block anchor is
        // claimed as a button node before it can be read as a link.
        priority: 60,
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false;
          if (!/display:\s*inline-block/i.test(dom.getAttribute('style') ?? '')) return false;
          return { href: dom.getAttribute('href') ?? '#', label: dom.textContent ?? '' };
        },
      },
    ],
    toDOM: (node) => ['a', { href: node.attrs['href'], style: BUTTON_STYLE }, node.attrs['label']],
  },
  commands: ({ schema }) => ({
    insertButton: (): Command => insertButton(schema),
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Button',
      keywords: ['button', 'cta', 'call to action', 'link'],
      icon: 'smart_button',
      command: insertButton(schema),
    },
  ],
});

function insertButton(schema: import('prosemirror-model').Schema): Command {
  return (state, dispatch) => {
    const node = schema.nodes['button'].create({ href: '#', label: 'Button' });
    dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
}
