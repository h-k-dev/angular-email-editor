import { InputRule } from 'prosemirror-inputrules';
import { NodeType } from 'prosemirror-model';
import { findWrapping, canJoin } from 'prosemirror-transform';

/**
 *
 * @param options.keepMarks - Whether to keep the marks of the trigger text.
 * @param options.joinPredicate - The predicate to determine if the trigger text can be joined with the previous node.
 * @param options.getAttributes - The attributes to set on the wrapped node.
 * @param options.updateWrappedNodeAttrs - Whether to update the attributes of the wrapped node.
 */
export function wrappingInputRule(
  regexp: RegExp,
  nodeType: NodeType,
  options?: {
    keepMarks?: boolean;
    joinPredicate?: (match: RegExpMatchArray, nodeBefore: any) => boolean;
    getAttributes?: Record<string, any> | ((match: RegExpMatchArray) => Record<string, any>);
    updateWrappedNodeAttrs?: boolean;
  },
) {
  return new InputRule(regexp, (state, match, start, end) => {
    let tr = state.tr;

    const attrs =
      typeof options?.getAttributes === 'function'
        ? options.getAttributes(match)
        : options?.getAttributes || {};

    // 1. Capture marks BEFORE modifying document
    const { selection, storedMarks } = state;
    const marks = storedMarks || (selection.$from.parentOffset ? selection.$from.marks() : null);

    // 2. Remove trigger text
    tr = tr.delete(start, end);

    // 3. Resolve position after deletion
    const $start = tr.doc.resolve(start);
    const range = $start.blockRange();

    if (!range) return null;

    // 4. Check if wrapping is allowed
    const wrapping = findWrapping(range, nodeType, attrs);
    if (!wrapping) return null;

    // 5. Apply wrapping
    tr = tr.wrap(range, wrapping);

    // 6. Restore marks (if requested)
    if (options?.keepMarks && marks) {
      tr = tr.ensureMarks(marks);
    }

    if (options?.updateWrappedNodeAttrs) {
      tr.doc.nodesBetween(range.start, range.end, (node, pos) => {
        if (node.type === nodeType) {
          tr = tr.setNodeMarkup(pos, nodeType, {
            ...node.attrs,
            ...attrs,
          });
        }
      });
    }

    // 7. Safely attempt to join with previous node
    const joinPos = start - 1;

    if (joinPos > 0) {
      const $pos = tr.doc.resolve(joinPos);
      const before = $pos.nodeBefore;

      if (
        before &&
        before.type === nodeType &&
        canJoin(tr.doc, joinPos) &&
        (!options?.joinPredicate || options.joinPredicate(match, before))
      ) {
        tr = tr.join(joinPos);
      }
    }

    return tr;
  });
}
