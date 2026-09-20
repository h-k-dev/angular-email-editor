import { Node, Schema } from 'prosemirror-model';
import { Command } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { defineNode } from '../../extension';

/** The button's canonical styling — the *border-based* bulletproof button:
    the touch target (≥ 44px tall, per the ledger) comes from borders in the
    background colour, not from padding, because Outlook's Word engine ignores
    padding on an anchor (the client-support module says so) and would render
    a padded button as a bare coloured text run — while it does draw borders
    on inline elements, so the box survives there too. No `height`. No
    `border-radius` — Outlook squares it anyway, and dropping it keeps our own
    output lint-clean. rgb() colours, not hex: the browser normalizes hex to
    rgb on the serialize round trip, so the canonical form must already be
    rgb to stay stable. */
export const BUTTON_STYLE =
  'display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
  'font-weight: bold; text-decoration: none; ' +
  // Longhands in the CSSOM's own order (width, style, color) and at the end,
  // where every serializer puts them — the canonical string is a fixpoint.
  'border-width: 14px 28px; border-style: solid; border-color: rgb(26, 115, 232);';

/**
 * A call-to-action button: an inline atom that serializes to a bordered
 * `inline-block` anchor — the email-safe "fake button" every client,
 * Outlook included, renders as a tappable coloured box. `display: inline-block` in the style is also the parse
 * discriminator: it is what tells a button apart from an ordinary link, so the
 * two never collide on the round trip.
 *
 * Inline, like an image, so it sits in a paragraph *or* a table cell
 * (`inline*`) — cells stay textblocks; they do not open to headings or
 * nested tables. It is an **atom** (label and href are attributes, not
 * editable content): a contentEditable `<a>` would ignore the node
 * boundary and unwrap when you type. The label and href are edited in
 * the HTML source pane, the same way image alt/width are. A dedicated
 * inline editor is a future polish item.
 */
export const Button = defineNode({
  name: 'button',
  spec: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: true,
    // The box already paints bold (and colour) on the `<a>`. Allowing marks
    // would re-parse that `font-weight: bold` as a wrapping `<strong>`.
    marks: '',
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
          // Collapsed: a formatter may print the label on its own line, and a
          // label never carries raw whitespace.
          const label = (dom.textContent ?? '').replace(/\s+/g, ' ').trim();
          return { href: dom.getAttribute('href') ?? '#', label };
        },
      },
    ],
    toDOM: (node) => ['a', { href: node.attrs['href'], style: BUTTON_STYLE }, node.attrs['label']],
  },
  commands: ({ schema }) => ({
    insertButton: (): Command => insertButton(schema),
  }),
  actions: ({ schema }) => [
    {
      id: 'button',
      title: 'Button',
      keywords: ['button', 'cta', 'call to action', 'link'],
      icon: 'smart_button',
      command: insertButton(schema),
    },
  ],
});

function insertButton(schema: Schema): Command {
  return (state, dispatch) => {
    const node = schema.nodes['button'].create({ href: '#', label: 'Button' });
    dispatch?.(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}

/**
 * The parser paints `font-weight: bold` from {@link BUTTON_STYLE} onto the
 * atom as a wrapping mark — it asks the parent, not the node, whether bold
 * is allowed. The box already is bold; those marks would re-serialize as a
 * `<strong>` around every button. Strip them so parse stays a fixpoint.
 */
export function bareButtons(doc: Node, schema: Schema): Node {
  if (!schema.nodes['button']) return doc;
  const tr = new Transform(doc);
  doc.descendants((node, pos) => {
    if (node.type.name === 'button' && node.marks.length) {
      tr.removeMark(pos, pos + node.nodeSize);
    }
    return true;
  });
  return tr.doc;
}
