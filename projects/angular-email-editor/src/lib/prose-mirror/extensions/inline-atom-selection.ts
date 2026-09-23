import { NodeSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { Node } from 'prosemirror-model';
import { defineExtension } from '../extension';

/** The class a text range puts on every inline atom it covers — an image,
    a button: the highlight the app draws, since the browser draws none. */
export const IN_SELECTION_CLASS = 'aee-atom--in-selection';

/** An inline atom with a box of its own — what a range can cover like a
    character, and a click selects whole: an image, a button. Not a line
    break, which has no box to paint. */
function isInlineAtom(node: Node): boolean {
  return (
    node.isInline &&
    node.isAtom &&
    !node.isText &&
    node.type.spec.selectable !== false &&
    !node.type.spec.linebreakReplacement &&
    node.type.name !== 'hardBreak'
  );
}

/** The position of the inline atom whose DOM holds a point, or null. */
function atomAt(view: EditorView, node: globalThis.Node): number | null {
  for (
    let element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    element && element !== view.dom && view.dom.contains(element);
    element = element.parentElement
  ) {
    const pos = view.posAtDOM(element, 0);
    const found = view.state.doc.nodeAt(pos);
    if (found && isInlineAtom(found) && view.nodeDOM(pos) === element) return pos;
  }
  return null;
}

/**
 * Inline atoms — an image, a button — selected the way characters are, by
 * a drag over them, and shown selected when they are.
 *
 * **Covering.** A drag that ends on an atom — or past it at the line's end,
 * where Chrome snaps the point into the nearest content — puts the DOM
 * endpoint *inside* its non-editable element, and ProseMirror reads any such
 * point as "before the atom": the range stops short of it (empty, when it
 * started right beside it). An endpoint in an atom covers it: it resolves to
 * the atom's far side from the other end.
 *
 * **Showing.** A range that covers an atom is a text selection (it copies
 * and deletes it as a character), but the element is contenteditable false,
 * so the browser never paints `::selection` on it: {@link IN_SELECTION_CLASS}
 * is the highlight the app draws instead. A click is a node selection;
 * `ProseMirror-selectednode` covers that.
 */
export const InlineAtomSelection = defineExtension({
  name: 'inlineAtomSelection',
  plugins: () => [
    new Plugin({
      key: new PluginKey('inlineAtomSelection'),
      props: {
        createSelectionBetween(view, $anchor, $head) {
          // The view's own root: inside a shadow root the document's
          // selection does not reach into it.
          const root = view.root as Document | (ShadowRoot & { getSelection?: () => Selection });
          const dom = root.getSelection?.() ?? view.dom.ownerDocument.getSelection();
          if (!dom?.anchorNode || !dom.focusNode) return null;
          const anchorAtom = atomAt(view, dom.anchorNode);
          const headAtom = atomAt(view, dom.focusNode);
          if (anchorAtom === null && headAtom === null) return null;
          if (anchorAtom !== null && anchorAtom === headAtom) return null;
          let anchor = $anchor.pos;
          let head = $head.pos;
          if (headAtom !== null) head = anchor <= headAtom ? headAtom + 1 : headAtom;
          if (anchorAtom !== null) anchor = head > anchorAtom ? anchorAtom : anchorAtom + 1;
          return TextSelection.create(view.state.doc, anchor, head);
        },
        decorations(state) {
          const { selection } = state;
          if (selection.empty || selection instanceof NodeSelection) return null;
          const decorations: Decoration[] = [];
          state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (isInlineAtom(node)) {
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, { class: IN_SELECTION_CLASS }),
              );
            }
          });
          return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
        },
      },
    }),
  ],
});
