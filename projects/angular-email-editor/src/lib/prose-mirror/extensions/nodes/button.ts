import { Fragment, Node, Schema, Slice } from 'prosemirror-model';
import {
  Command,
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { closeHistory } from 'prosemirror-history';
import { FunctionalExtension, defineExtension, defineNode } from '../../extension';
import { isSafeUrl } from '../marks/link';
import { soleInlineAtom } from '../inline-atoms';

/** The button's canonical styling — the *border-based* bulletproof button:
    the touch target (≥ 44px tall, per the ledger) comes from borders in the
    background colour, not from padding, because Outlook's Word engine ignores
    padding on an anchor (the client-support module says so) and would render
    a padded button as a bare coloured text run — while it does draw borders
    on inline elements, so the box survives there too. No `height`. No
    `border-radius` — Outlook squares it anyway, and dropping it keeps our own
    output lint-clean. rgb() colours, not hex: the browser normalizes hex to
    rgb on the serialize round trip, so the canonical form must already be
    rgb to stay stable. The label's weight and slant are the button's
    own (`bold`, `italic`): this is a default button's. */
export const BUTTON_STYLE = buttonStyle({ bold: true, italic: false });

/** The canonical style of a button with that label styling: bold is
    `font-weight: bold` and not bold `normal` (said, never left out — a
    client's own anchor styling may be bold); italic adds `font-style`
    after the weight, and not italic leaves it out. */
export function buttonStyle({ bold, italic }: { bold: boolean; italic: boolean }): string {
  return (
    'display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); ' +
    `font-weight: ${bold ? 'bold' : 'normal'}; ` +
    (italic ? 'font-style: italic; ' : '') +
    'text-decoration: none; ' +
    // Longhands in the CSSOM's own order (width, style, color) and at the end,
    // where every serializer puts them — the canonical string is a fixpoint.
    'border-width: 14px 28px; border-style: solid; border-color: rgb(26, 115, 232);'
  );
}

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
 * boundary and unwrap when you type. Selected text becomes one, and a
 * button linked text again (`button-link`, a toggle); a selected button's
 * link is set with `setButtonHref`, its words with `setButtonLabel`. The
 * label is bold or italic as a whole — attributes, not marks: the kit's own
 * Bold and Italic (the toolbar's, Mod-B, Mod-I) flip them on a selected
 * button (`markAttrs`, see `selectedMarkAtom`).
 */
export const Button = defineNode({
  name: 'button',
  spec: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: true,
    // The box paints its own weight, slant and colour on the `<a>`. Allowing
    // marks would re-parse that `font-weight: bold` as a wrapping `<strong>`
    // — so bold and italic are attributes, which the kit's mark toggles set
    // on a selected button.
    marks: '',
    markAttrs: ['bold', 'italic'],
    attrs: {
      href: { default: '#' },
      label: { default: 'Button' },
      bold: { default: true },
      italic: { default: false },
    },
    parseDOM: [
      {
        tag: 'a[href]',
        // Higher than the link mark's default so an inline-block anchor is
        // claimed as a button node before it can be read as a link.
        priority: 60,
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false;
          if (!/display:\s*inline-block/i.test(dom.getAttribute('style') ?? '')) return false;
          // Same rule as the link mark: a script URL kills the button on
          // parse — and, refused here, the link mark refuses it too.
          const href = dom.getAttribute('href') ?? UNSET_BUTTON_HREF;
          if (!isSafeUrl(href)) return false;
          // Collapsed: a formatter may print the label on its own line, and a
          // label never carries raw whitespace.
          const label = (dom.textContent ?? '').replace(/\s+/g, ' ').trim();
          // Bold unless the weight is said to be less; italic where the
          // slant is said — the label's styling reads off the box alone.
          const bold = !/^(normal|lighter|[1-4]\d\d)$/i.test(dom.style.fontWeight.trim());
          const italic = /^(italic|oblique)/i.test(dom.style.fontStyle.trim());
          return { href, label, bold, italic };
        },
      },
    ],
    // In the editor: content, not a stop on the page's Tab order — a link
    // is focusable, and inside a non-editable island it would take a Tab
    // (and a click's focus) away from the text. The email never carries
    // that: see emitDOM.
    toDOM: (node) => ['a', { ...buttonAttrs(node), tabindex: '-1' }, node.attrs['label']],
    // Serialization-only (see serializeToHTML): the anchor as it is sent.
    emitDOM: (node: Node) => ['a', buttonAttrs(node), node.attrs['label']],
  },
  plugins: () => [
    new Plugin({
      key: new PluginKey('buttonClick'),
      props: {
        // A click on a button edits it — it never follows it, with or
        // without Ctrl/Cmd (this runs before the link mark's handleClick,
        // and answering stops it). The button is selected, and a host that
        // asked (`createButtonEdit`) is told to open its link editor.
        handleClickOn: (view, _pos, node, nodePos, _event, direct) => {
          if (!direct || node.type.name !== 'button') return false;
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
          // The caret is the editor's, not the anchor's: Delete and typing
          // act on the selected button.
          view.focus();
          const onEdit = buttonEditKey.getState(view.state)?.onEdit;
          if (onEdit) {
            const dom = view.nodeDOM(nodePos) as HTMLElement | null;
            onEdit({ pos: nodePos, rect: dom?.getBoundingClientRect() ?? null });
          }
          return true;
        },
        // The anchor is non-editable (an atom), so to the browser it is a
        // live link: a click — a middle click too — would open it, in a new
        // tab (`target="_blank"`). In the editor it is content, not a way out.
        handleDOMEvents: {
          click: preventButtonNavigation,
          auxclick: preventButtonNavigation,
        },
        // Pasted HTML is parsed like a document, and paints the same
        // `<strong>` around every button (see `bareButtons`): stripped here
        // too, so a pasted button is as bare as a loaded one.
        transformPasted: (slice) =>
          new Slice(bareButtonsIn(slice.content), slice.openStart, slice.openEnd),
      },
    }),
  ],
  commands: ({ schema }) => ({
    insertButton: (): Command => insertButton(schema),
    toggleButtonLink: (): Command => toggleButtonLink,
    setButtonHref: (href: string): Command => setButtonHref(href),
    setButtonLabel: (label: string): Command => setButtonLabel(label),
  }),
  actions: ({ schema }) => [
    {
      id: 'button',
      section: 'layout',
      title: 'Button',
      keywords: ['button', 'cta', 'call to action', 'link'],
      icon: 'smart_button',
      command: insertButton(schema),
    },
    // The selection's own: selected text becomes a button, a selected
    // button becomes linked text again. Needs one or the other, so a `/`
    // menu (a caret) never offers it.
    {
      id: 'button-link',
      section: 'layout',
      title: 'Button link',
      keywords: ['button', 'cta', 'call to action', 'link'],
      icon: 'smart_button',
      command: toggleButtonLink,
      isEnabled: (state) => !!selectedButton(state) || !!buttonLabelAt(state),
      isActive: (state) => !!selectedButton(state),
    },
  ],
});

/** A button's anchor attributes as the email carries them: a new tab,
    without the opener — what every link in the email carries (the link
    mark's defaults), so a button is no exception to it. */
function buttonAttrs(node: Node): Record<string, string> {
  return {
    href: node.attrs['href'] as string,
    target: '_blank',
    rel: 'noopener noreferrer',
    style: buttonStyle(node.attrs as { bold: boolean; italic: boolean }),
  };
}

/** Stops the browser following a button's anchor. Never answers: the
    event stays ProseMirror's (and the page's) otherwise. */
function preventButtonNavigation(view: EditorView, event: MouseEvent): boolean {
  const anchor = (event.target as Element | null)?.closest?.('a');
  if (!anchor || !view.dom.contains(anchor)) return false;
  const node = view.state.doc.nodeAt(view.posAtDOM(anchor, 0));
  if (node?.type.name === 'button') event.preventDefault();
  return false;
}

/** Where a clicked button is, for the host's link editor to stand on. */
export interface ButtonEditTarget {
  pos: number;
  /** The button's box in viewport coordinates — null where nothing is laid
      out (a test DOM). */
  rect: DOMRect | null;
}

export interface ButtonEditOptions {
  /** A button was clicked, and is now the selection: open its link editor.
      (A click never follows the button's link — its editor's own "open"
      is the way out.) */
  onEdit: (target: ButtonEditTarget) => void;
}

const buttonEditKey = new PluginKey<ButtonEditOptions>('buttonEdit');

/**
 * What a click on a button does, told to the host: the kit selects the
 * button and never follows its link; this hands the host the moment to
 * open its link editor on it — the one a text link opens with, so a button
 * is edited the way a link is. Without it, a click only selects the button
 * (and a bubble menu can offer the editor).
 *
 *     createButtonEdit({ onEdit: () => linkEditor.show() })
 */
export const createButtonEdit = (options: ButtonEditOptions): FunctionalExtension =>
  defineExtension({
    name: 'buttonEdit',
    plugins: () => [
      new Plugin<ButtonEditOptions>({
        key: buttonEditKey,
        state: { init: () => options, apply: (_tr, value) => value },
      }),
    ],
  });

/** The button a selection holds and nothing else, or null: a click's node
    selection, or a range — a drag's, Shift-arrow's — that covers the button
    and whitespace only (see `soleInlineAtom`). A range with text in it is
    a text selection: the button in it takes the text styling with the
    text (its `bold`, its `italic`). */
export function selectedButton(state: EditorState): { pos: number; node: Node } | null {
  return soleInlineAtom(state, 'button');
}

/** A button's `href` before it has been given one — the placeholder
    `insertButton` and a text without a link start from. */
export const UNSET_BUTTON_HREF = '#';

/**
 * What a text selection would become, or null when it cannot be a button:
 * the range must lie in one line and hold text only — an image or a line
 * break is not a label (a `{{ token }}` is: it is text, and personalizes
 * the button) — and say something. The range is the selection *without*
 * the whitespace at its ends: a double-click that took a word's trailing
 * space must not swallow the space into the button and glue the words
 * around it together. The label is its text with the whitespace inside
 * collapsed (a label never carries raw whitespace, see the parse rule).
 */
function buttonLabelAt(state: EditorState): { from: number; to: number; label: string } | null {
  const { selection, schema } = state;
  if (!schema.nodes['button'] || !(selection instanceof TextSelection) || selection.empty) {
    return null;
  }
  const { $from, $to } = selection;
  if (!$from.sameParent($to) || !$from.parent.inlineContent) return null;
  let textOnly = true;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isInline && !node.isText) textOnly = false;
    return textOnly;
  });
  if (!textOnly) return null;
  // Text only, in one parent: one character per position.
  const text = state.doc.textBetween(selection.from, selection.to);
  const label = text.replace(/\s+/g, ' ').trim();
  if (!label) return null;
  const from = selection.from + (text.length - text.trimStart().length);
  const to = selection.to - (text.length - text.trimEnd().length);
  return { from, to, label };
}

/**
 * Selected text → a button: the text is its label, the link it carried (if
 * any) its `href`, and the button is left selected. A selected button →
 * linked text again: the label, carrying the button's link (none for a
 * placeholder `#`), left selected as text. Whatever marks the text had —
 * bold, a colour — do not survive into the button: it is an atom that
 * paints itself (see `BUTTON_STYLE`).
 */
const toggleButtonLink: Command = (state, dispatch) => {
  const button = selectedButton(state);
  if (button) {
    if (dispatch) {
      const { href, label } = button.node.attrs as { href: string; label: string };
      const link = state.schema.marks['link'];
      const marks = link && href !== UNSET_BUTTON_HREF ? [link.create({ href })] : [];
      const text = state.schema.text(label, marks);
      const tr = state.tr.replaceWith(button.pos, button.pos + button.node.nodeSize, text);
      tr.setSelection(TextSelection.create(tr.doc, button.pos, button.pos + text.nodeSize));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  const target = buttonLabelAt(state);
  if (!target) return false;
  if (dispatch) {
    const { from, to, label } = target;
    const link = state.schema.marks['link'];
    let href = UNSET_BUTTON_HREF;
    if (link) {
      state.doc.nodesBetween(from, to, (node) => {
        const mark = link.isInSet(node.marks);
        if (mark && href === UNSET_BUTTON_HREF) href = mark.attrs['href'] as string;
      });
    }
    const node = state.schema.nodes['button'].create({ href, label });
    // Its own history event, never merged into the typing just before it:
    // one undo takes back exactly the conversion — what a host does when
    // the new button is left without a link.
    const tr = closeHistory(state.tr).replaceWith(from, to, node);
    tr.setSelection(NodeSelection.create(tr.doc, from));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Sets the selected button's link, keeping it selected. An empty href is
    the placeholder again; a script URL is refused, as the link mark's is. */
const setButtonHref =
  (href: string): Command =>
  (state, dispatch) => {
    const button = selectedButton(state);
    if (!button || (href.trim() && !isSafeUrl(href))) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(button.pos, undefined, {
        ...button.node.attrs,
        href: href.trim() || UNSET_BUTTON_HREF,
      });
      tr.setSelection(NodeSelection.create(tr.doc, button.pos));
      dispatch(tr);
    }
    return true;
  };

/** Sets the selected button's words, keeping it selected. Whitespace inside
    is collapsed, as a parsed label's is; a label with no words is refused —
    a button always says something. */
const setButtonLabel =
  (label: string): Command =>
  (state, dispatch) => {
    const button = selectedButton(state);
    const words = label.replace(/\s+/g, ' ').trim();
    if (!button || !words) return false;
    if (dispatch && words !== button.node.attrs['label']) {
      const tr = state.tr.setNodeAttribute(button.pos, 'label', words);
      tr.setSelection(NodeSelection.create(tr.doc, button.pos));
      dispatch(tr);
    }
    return true;
  };

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
  return doc.copy(bareButtonsIn(doc.content));
}

/** The fragment with every button in it stripped of its marks — the same
    fragment where none carries any. */
function bareButtonsIn(fragment: Fragment): Fragment {
  let changed = false;
  const children: Node[] = [];
  fragment.forEach((node) => {
    let next = node;
    if (node.type.name === 'button') {
      if (node.marks.length) next = node.mark([]);
    } else if (!node.isLeaf) {
      const content = bareButtonsIn(node.content);
      if (content !== node.content) next = node.copy(content);
    }
    if (next !== node) changed = true;
    children.push(next);
  });
  return changed ? Fragment.fromArray(children) : fragment;
}
