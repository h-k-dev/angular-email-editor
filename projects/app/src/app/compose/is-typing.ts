import type { EditorView } from 'prosemirror-view';

/**
 * Whether the user is typing into this view right now: it holds focus *and*
 * its window does. ProseMirror's `hasFocus()` only asks whether the view is
 * the document's active element — and it stays that while its tab sits in
 * the background. A pane that skipped an incoming write on that answer (a
 * draft saved in another tab) would hold it until a blur that has already
 * happened, and the user would type over a stale document.
 */
export function isTyping(view: EditorView): boolean {
  return view.hasFocus() && view.dom.ownerDocument.hasFocus();
}
