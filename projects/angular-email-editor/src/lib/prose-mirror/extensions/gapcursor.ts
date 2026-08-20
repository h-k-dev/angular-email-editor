import { gapCursor } from 'prosemirror-gapcursor';
import { defineExtension } from '../extension';

/**
 * A real cursor in the gaps *between* block nodes — ProseMirror's own answer to
 * the trap every layout block falls into: our table and columns are
 * `isolating`, so when one is the last thing in the document there is no text
 * position after it, and clicking the empty space below it does nothing.
 *
 * With this, that click (and ArrowDown/ArrowRight out of a block, and a
 * click *between* two adjacent blocks) lands a blinking gap cursor; typing
 * there creates a paragraph. It is the mouse sibling of the block escapes we
 * hand-rolled per node — one mechanism, every block, no per-node code.
 *
 * Ordering note: this must sit *after* the layout nodes in the kit. Extension
 * plugins run in kit order and gap-cursor claims the arrow keys, so the
 * table's own ArrowDown escape (which writes a paragraph below a trailing
 * table rather than parking a cursor in the gap) has to be reached first.
 *
 * Pixels: `.ProseMirror-gapcursor` in the app's global styles, transcribed
 * from `prosemirror-gapcursor/style/gapcursor.css` (MIT) and scoped to
 * `.aee-editor` like everything else we ship.
 */
export const Gapcursor = defineExtension({
  name: 'gapcursor',
  plugins: () => [gapCursor()],
});
