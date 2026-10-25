import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { layoutInteractive } from './layout-interaction';

/** The column of a columns block whose grip was pressed, and where the grip
    is on screen — what the host's menu anchors to. */
export interface ColumnHandleTarget {
  kind: 'layout-column';
  /** The column's position in the document. Read it again before acting:
      the caret is still in the column, so the caret-relative commands
      (`setColumnBackground`, `setColumnVerticalAlign`) need no position. */
  columnPos: number;
  /** The grip's own rect. */
  boundingBox: DOMRect;
}

export interface ColumnHandlesOptions {
  /** A column's grip was pressed, or the grip went away under an open menu
      (`null`) — the layout switched static, the column was removed. */
  onOpen: (target: ColumnHandleTarget | null) => void;
  /** What the grip says to assistive tech, translated by the host; called
      with the column's 1-based number. */
  label?: (number: number) => string;
}

const columnHandlesKey = new PluginKey('columnHandles');

/**
 * The caret column's grip — the table cell's (table-handles.ts), on a
 * columns block: a pill on the right edge of the column the caret is in,
 * which opens the host's cell menu for it — fill, alignment, where its
 * content sits beside a taller neighbour. The caret stays where it is, so
 * the menu's actions are the ordinary caret-relative column commands.
 *
 * Shown only while the columns are interactive (`layoutInteraction`):
 * writing in a template whose layout is settled, a column takes no gesture.
 * A caret in a table inside the column is the table's: its cell has a grip
 * of its own, and one menu at a time is the rule.
 *
 * Built from the selection alone and keyed by the column, so typing in it
 * never rebuilds the grip under the pointer.
 */
export const createColumnHandles = (options: ColumnHandlesOptions): FunctionalExtension => {
  const label = options.label ?? ((number: number) => `Column ${number} options`);

  const columnGrip = (view: EditorView, number: number): HTMLElement => {
    const el = document.createElement('span');
    // The table cell's face and place (the host's `.aee-grip--cell`).
    el.className = 'aee-grip aee-grip--cell aee-grip--layout-column';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label(number));
    el.setAttribute('title', label(number));
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.contentEditable = 'false';
    el.appendChild(document.createElement('i'));
    // Not the editor's press: it would move the caret out of the column.
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const columnPos = caretColumn(view.state)?.pos;
      if (columnPos === undefined) return;
      el.setAttribute('aria-expanded', 'true');
      // The menu takes the focus and hands it back to the text when it is
      // done: that return is the grip's cue to fold.
      view.dom.addEventListener('focus', () => el.setAttribute('aria-expanded', 'false'), {
        once: true,
      });
      options.onOpen({
        kind: 'layout-column',
        columnPos,
        boundingBox: el.getBoundingClientRect(),
      });
    });
    return el;
  };

  return defineExtension({
    name: 'columnHandles',
    plugins: () => [
      new Plugin({
        key: columnHandlesKey,
        props: {
          decorations: (state) => {
            if (!layoutInteractive(state, 'columns')) return null;
            const column = caretColumn(state);
            if (!column) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(column.pos + 1, (view) => columnGrip(view, column.index + 1), {
                key: `column-grip-${column.pos}`,
                side: -1,
                ignoreSelection: true,
              }),
            ]);
          },
        },
        view: (view) => {
          let interactive = layoutInteractive(view.state, 'columns');
          return {
            update: () => {
              // Switched static, or the column gone, under an open menu: the
              // grip it hangs from is gone.
              const now = layoutInteractive(view.state, 'columns');
              if (interactive && !now) options.onOpen(null);
              interactive = now;
            },
          };
        },
      }),
    ],
  });
};

/** The column the caret is in — the innermost — with its index in its
    block; null outside one, and for a caret in a table inside it. */
function caretColumn(state: EditorState): { pos: number; index: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 1; depth--) {
    const node = $from.node(depth);
    if (node.type.spec['tableRole'] === 'cell') return null;
    if (node.type.name === 'column') {
      return { pos: $from.before(depth), index: $from.index(depth - 1) };
    }
  }
  return null;
}
