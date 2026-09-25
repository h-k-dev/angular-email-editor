import { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';

/** An inline atom with a box of its own — what a range can cover like a
    character, and a click selects whole: an image, a button. Not a line
    break, which has no box to paint. */
export function isInlineAtom(node: Node): boolean {
  return (
    node.isInline &&
    node.isAtom &&
    !node.isText &&
    node.type.spec.selectable !== false &&
    !node.type.spec.linebreakReplacement &&
    node.type.name !== 'hardBreak'
  );
}

/** The marks an atom takes as boolean attributes of the mark's name — a
    button's `bold` and `italic` (`markAttrs` in its spec). Empty for the
    rest. */
export function markAttrsOf(node: Node): readonly string[] {
  return (node.type.spec['markAttrs'] as readonly string[] | undefined) ?? [];
}

export interface InlineAtomAt {
  pos: number;
  node: Node;
}

/** The one inline atom a range holds beside whitespace, or null — see
    {@link soleInlineAtom}. */
function soleAtomIn(doc: Node, from: number, to: number): InlineAtomAt | null {
  let atom: InlineAtomAt | null = null;
  let other = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (other) return false;
    if (!node.isInline) return true;
    if (node.isText) {
      // Only the part inside the range: a drag that took half a word took
      // letters, one that stopped in the spaces before it took none.
      const text = (node.text ?? '').slice(
        Math.max(from, pos) - pos,
        Math.min(to, pos + node.nodeSize) - pos,
      );
      if (text.trim()) other = true;
    } else if (isInlineAtom(node)) {
      if (atom) other = true;
      else atom = { pos, node };
    }
    // A line break, or any other inline leaf, is whitespace.
    return false;
  });
  return other ? null : atom;
}

/**
 * The inline atom a selection holds and nothing else, or null: a click's
 * node selection, or a range — a drag's, Shift-arrow's — whose content is
 * that one atom. Whitespace does not count: a range that took the spaces or
 * tabs around an image, or the line break after it, still holds the image
 * alone (a hundred spaces are no space). A letter does, and so does a
 * second atom — a range over an image and a button is a text selection.
 *
 * What an atom's own chrome keys on: an image's bubble menu, a button's,
 * their actions. `type` narrows it to one node type.
 */
export function soleInlineAtom(state: EditorState, type?: string): InlineAtomAt | null {
  const { selection, doc } = state;
  let atom: InlineAtomAt | null = null;
  if (selection instanceof NodeSelection) {
    if (isInlineAtom(selection.node)) atom = { pos: selection.from, node: selection.node };
  } else if (!selection.empty && selection instanceof TextSelection) {
    atom = soleAtomIn(doc, selection.from, selection.to);
  }
  if (!atom) return null;
  return type && atom.node.type.name !== type ? null : atom;
}
