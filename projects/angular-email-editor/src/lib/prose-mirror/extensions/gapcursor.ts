import { gapCursor } from 'prosemirror-gapcursor';
import { Plugin } from 'prosemirror-state';
import { defineExtension } from '../extension';
import { suggestionMenuOpen } from './suggestion-menu';

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
 * The same order puts it *before* a host's suggestion menu, which is added
 * after the kit — and inside an isolating block (a section, a column, a
 * cell) a one-line textblock is its own end both ways, so ArrowUp/ArrowDown
 * on a `/` query stepped out to the gap beside the block instead of moving
 * the menu's highlight. While a menu shows, those two arrows are let through
 * to it (see `suggestionMenuOpen`).
 *
 * Pixels: `.ProseMirror-gapcursor` in the app's global styles, transcribed
 * from `prosemirror-gapcursor/style/gapcursor.css` (MIT) and scoped to
 * `.aee-editor` like everything else we ship.
 */
export const Gapcursor = defineExtension({
  name: 'gapcursor',
  plugins: () => {
    const { props } = gapCursor();
    const arrows = props.handleKeyDown!;
    return [
      new Plugin({
        props: {
          ...props,
          handleKeyDown(view, event) {
            const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
            if (vertical && suggestionMenuOpen(view)) return false;
            return arrows.call(this, view, event);
          },
        },
      }),
    ];
  },
});
