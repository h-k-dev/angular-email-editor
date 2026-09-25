import {
  Command,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { Node } from 'prosemirror-model';
import { defineExtension } from '../extension';
import { isInlineAtom } from './inline-atoms';

export { isInlineAtom, soleInlineAtom, markAttrsOf } from './inline-atoms';
export type { InlineAtomAt } from './inline-atoms';

/** The class a text range puts on every inline atom it covers — an image,
    a button: the highlight the app draws, since the browser draws none. */
export const IN_SELECTION_CLASS = 'aee-atom--in-selection';

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

/** Whether a textblock holds an inline atom — a line with an image or a
    button in it. */
function holdsAtom(textblock: Node): boolean {
  let holds = false;
  textblock.forEach((child) => {
    if (isInlineAtom(child)) holds = true;
  });
  return holds;
}

/**
 * Shift-arrow from a selected atom grows a range from it, the way it grows
 * one from a selected letter: the atom stays in, and the next character —
 * or atom, or line — joins it. (ProseMirror alone collapses the node
 * selection to a caret beside the atom, and the atom is lost.) The anchor
 * is the atom's far side, so the range covers it.
 */
const extendFromAtom =
  (dir: 1 | -1): Command =>
  (state, dispatch) => {
    const { selection, doc } = state;
    if (!(selection instanceof NodeSelection) || !isInlineAtom(selection.node)) return false;
    const $edge = dir > 0 ? selection.$to : selection.$from;
    const next = dir > 0 ? $edge.nodeAfter : $edge.nodeBefore;
    let head = $edge.pos;
    if (next) {
      head += dir * (next.isText ? 1 : next.nodeSize);
    } else {
      // The line's end: the next line's start (or the previous line's end).
      const beyond = Selection.findFrom(
        doc.resolve(dir > 0 ? $edge.after() : $edge.before()),
        dir,
        true,
      );
      if (beyond) head = beyond.head;
    }
    const anchor = dir > 0 ? selection.from : selection.to;
    dispatch?.(
      state.tr
        .setSelection(TextSelection.between(doc.resolve(anchor), doc.resolve(head)))
        .scrollIntoView(),
    );
    return true;
  };

/** A mouse drag in progress, from its press. */
interface Drag {
  /** The press as a document position: the anchor of a range made here. */
  press: number;
  /** The atom pressed on, if any: the range then anchors on its far side. */
  atom: number | null;
  /** Whether the plugin makes the whole selection (`own`: a press on an
      atom, or in a line with one — the browser was kept from it), or only
      corrects the browser's for the stretch the pointer spends over an
      atom. */
  own: boolean;
  /** Where the pointer is, once it has moved. */
  pointer: { left: number; top: number } | null;
  /** Past the click's slack: a drag, not a click. */
  moved: boolean;
  /** The selection as the press found it — a click that changed nothing
      through ProseMirror's own handling puts the caret at the press. */
  before: Selection;
}

/**
 * The range a drag makes for where its pointer is — or null where the
 * browser's own selection serves (a drag the plugin does not own, with the
 * pointer over text).
 *
 * The pointer over an atom takes it whole, whichever half it is over:
 * `posAtCoords` names the node under the point, where the browser would
 * only snap the point to the atom's nearer side (and then keep the
 * selection off the non-editable island altogether). A drag from an atom
 * anchors on the atom's side away from the head, so the atom stays in
 * whichever way the drag runs — and is the range alone while the pointer
 * is on it.
 */
function dragRange(view: EditorView, drag: Drag): Selection | null {
  if (!drag.pointer) return null;
  const found = view.posAtCoords(drag.pointer);
  if (!found) return null;
  const { doc } = view.state;
  const under = found.inside >= 0 ? doc.nodeAt(found.inside) : null;
  const over = under && isInlineAtom(under) ? found.inside : null;
  if (!drag.own && over === null) return null;
  if (drag.atom !== null && !doc.nodeAt(drag.atom)) return null;
  const press = Math.min(drag.press, doc.content.size);
  const base = drag.atom ?? press;
  const head = over !== null ? (over >= base ? over + 1 : over) : found.pos;
  const anchor = drag.atom === null ? press : head > drag.atom ? drag.atom : drag.atom + 1;
  return TextSelection.between(doc.resolve(anchor), doc.resolve(head));
}

/** The click's slack: a hand at rest still moves a pixel or two. */
const CLICK_SLACK = 4;

/**
 * Inline atoms — an image, a button — selected the way characters are, by
 * a click-drag over them, and shown selected when they are.
 *
 * **Why by hand.** An atom is a non-editable island in the editable text,
 * and the browser's selection will not treat it as a character: a
 * selection based inside the island never leaves it, and one based
 * beside it — anywhere on its line — will not grow over it either (Chrome
 * keeps a selection from crossing an editing boundary, and snaps a point
 * over the island to its nearer side). The atom's element, draggable,
 * answers a press with a drag of itself besides. Only a drag from another
 * line, passing clear across the atom, covers it on its own.
 *
 * **So.** A press on an atom, or on a line that holds one, is kept from
 * the browser at `mousedown` (its default is prevented — after
 * ProseMirror's own handling of the press, which stays: a press released
 * in place is still its click, the node selection, a button's link
 * editor), and the plugin makes the selection itself from the press,
 * following the pointer through `posAtCoords` (`dragRange`). A press
 * elsewhere is the browser's drag, corrected for the stretch the pointer
 * spends over an atom — on each move, and again whenever ProseMirror reads
 * the browser's selection back, so the two never disagree. Where the
 * browser puts a DOM endpoint *inside* an atom's element (past it at the
 * line's end), ProseMirror reads the point as "before the atom": such an
 * endpoint covers the atom too. A *selected* atom's press is ProseMirror's
 * whole: its drag moves the node, as in Gmail. Shift-arrow from a selected
 * atom grows a range that keeps it (`extendFromAtom`).
 *
 * **Showing.** A range that covers an atom is a text selection (it copies
 * and deletes it as a character), but the element is contenteditable false,
 * so the browser never paints `::selection` on it: {@link IN_SELECTION_CLASS}
 * is the highlight the app draws instead. A click is a node selection;
 * `ProseMirror-selectednode` covers that.
 *
 * What an atom's own chrome (a bubble menu) keys on is {@link soleInlineAtom}:
 * the atom alone, clicked or dragged over with nothing but whitespace.
 */
export const InlineAtomSelection = defineExtension({
  name: 'inlineAtomSelection',
  keymap: () => ({
    'Shift-ArrowRight': extendFromAtom(1),
    'Shift-ArrowLeft': extendFromAtom(-1),
  }),
  plugins: () => {
    // The mouse drag in progress, if any (one editor's).
    let drag: Drag | null = null;
    let forget: ReturnType<typeof setTimeout> | undefined;
    return [
      new Plugin({
        key: new PluginKey('inlineAtomSelection'),
        view: (view) => {
          const select = (selection: Selection | null) => {
            if (selection && !selection.eq(view.state.selection)) {
              view.dispatch(view.state.tr.setSelection(selection));
            }
          };
          const follow = (current: Drag) => {
            const move = (event: MouseEvent) => {
              if (view.isDestroyed) return stop();
              current.pointer = { left: event.clientX, top: event.clientY };
              if (!current.moved) {
                if (
                  current.own &&
                  Math.abs(event.clientX - pressed.x) < CLICK_SLACK &&
                  Math.abs(event.clientY - pressed.y) < CLICK_SLACK
                ) {
                  return;
                }
                current.moved = true;
              }
              select(dragRange(view, current));
            };
            const up = () => {
              stop();
              if (view.isDestroyed) return;
              // A click the plugin kept from the browser, which ProseMirror
              // answered with nothing (a press in the text — the browser
              // would have placed the caret): the caret, at the press.
              if (current.own && !current.moved && current.before.eq(view.state.selection)) {
                const $press = view.state.doc.resolve(
                  Math.min(current.press, view.state.doc.content.size),
                );
                select(Selection.near($press));
              }
              // The browser's last word on its selection comes a moment
              // after the release, and is read against the drag still.
              forget = setTimeout(() => {
                if (drag === current) drag = null;
              }, 100);
            };
            const stop = () => {
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            const pressed = { x: current.pointer?.left ?? 0, y: current.pointer?.top ?? 0 };
            current.pointer = null;
            clearTimeout(forget);
            drag = current;
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          };
          // After ProseMirror's own mousedown handling (registered before
          // this, at the view's creation), so its click stays.
          const down = (event: MouseEvent) => {
            if (!view.editable || event.button !== 0 || event.shiftKey || event.detail > 1) return;
            const atom = atomAt(view, event.target as globalThis.Node);
            const { selection } = view.state;
            // The selected atom's press is ProseMirror's: its drag moves it.
            if (atom !== null && selection instanceof NodeSelection && selection.from === atom) {
              return;
            }
            const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!found) return;
            const $press = view.state.doc.resolve(found.pos);
            const own = atom !== null || ($press.parent.isTextblock && holdsAtom($press.parent));
            if (own) {
              // No browser selection, no drag of the element, no focus on
              // it (a button's anchor would take it): the editor's.
              event.preventDefault();
              view.focus();
            }
            follow({
              press: found.pos,
              atom,
              own,
              pointer: { left: event.clientX, top: event.clientY },
              moved: false,
              before: selection,
            });
          };
          view.dom.addEventListener('mousedown', down);
          return {
            destroy() {
              view.dom.removeEventListener('mousedown', down);
              clearTimeout(forget);
              drag = null;
            },
          };
        },
        props: {
          createSelectionBetween(view, $anchor, $head) {
            // Mid-drag, what the browser says is beside the point: the
            // drag's own range, whatever was read (its re-reads then all
            // agree, and the selection holds still).
            if (drag) {
              const range = dragRange(view, drag);
              if (range) return range;
            }
            // The view's own root: inside a shadow root the document's
            // selection does not reach into it.
            const root = view.root as
              Document | (ShadowRoot & { getSelection?: () => globalThis.Selection });
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
          handleDOMEvents: {
            // A drag of an unselected atom that got past a press the
            // plugin never saw (a synthetic press, a pen): cancelled, and
            // the atom is the selection — where the pointer goes from
            // here the press's own tracking would have followed.
            dragstart(view, event) {
              if (!view.editable) return false;
              const atom = atomAt(view, event.target as globalThis.Node);
              if (atom === null) return false;
              const { selection } = view.state;
              // The selected atom moves by drag — ProseMirror's own.
              if (selection instanceof NodeSelection && selection.from === atom) return false;
              event.preventDefault();
              view.focus();
              view.dispatch(
                view.state.tr.setSelection(TextSelection.create(view.state.doc, atom, atom + 1)),
              );
              return true;
            },
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
    ];
  },
});
