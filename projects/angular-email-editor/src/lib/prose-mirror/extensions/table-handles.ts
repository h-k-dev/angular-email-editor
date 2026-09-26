import { EditorState, Plugin, PluginKey, Selection, Transaction } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { CellSelection, TableMap } from 'prosemirror-tables';
import { FunctionalExtension, defineExtension } from '../extension';
import { selectColumn, selectRow } from './nodes/table';

/** Which band of which table a grip stands for, and where it is on screen. */
export interface TableHandleTarget {
  kind: 'row' | 'column';
  /** The band's index in the grid, counted from the top / the start. */
  index: number;
  /** The table's position in the document — what the select commands take. */
  tablePos: number;
  /** The grip's own rect: what the app's menu anchors to. */
  boundingBox: DOMRect;
}

export interface TableHandlesOptions {
  /** A grip was pressed (its band is selected by then), or the handles have
      nothing to offer any more (`null`) — the table went away under them. */
  onOpen: (target: TableHandleTarget | null) => void;
  /** What a grip says to assistive tech, translated by the host. Called with
      the band's 1-based number, as a person counts rows. */
  label?: (kind: 'row' | 'column', number: number) => string;
}

interface TableHandlesState {
  decorations: DecorationSet;
  /** Every table and the node we last built grips from — identity compare
      tells a later transaction whether the *grid* moved, or only the text
      inside a cell (the common case, and the one that must stay cheap). */
  tables: { pos: number; node: Node }[];
  /** Bumped only when the grip set is rebuilt. Mapping through a keystroke
      keeps this number, so the view can skip the expanded-attribute pass
      — `DecorationSet.map` returns a new set every time, and comparing
      those by identity would redo the DOM walk on every insert. */
  generation: number;
}

const tableHandlesKey = new PluginKey<TableHandlesState>('tableHandles');

/**
 * The row and column grips: a handle on each row's flank and above each
 * column, the gesture every table editor has settled on (Notion's, Google
 * Docs', Domternal's). Pressing one selects that whole band and hands the
 * host a target to open a menu at — insert, move, duplicate, fill, align,
 * delete — all of which are the ordinary selection-relative commands once
 * the band is selected.
 *
 * **The grips are widget decorations inside the band's first cell**, not an
 * overlay measured against the table. That is the whole trick: a decoration
 * in a cell is positioned by that cell's own box, so a row grip is exactly
 * as tall as its row and a column grip exactly as wide as its column,
 * through merged cells, wrapped text and a resize drag alike — with no
 * measurement, no ResizeObserver and no pointer tracking, which is the same
 * bargain the boundary lines strike (see column-resize.ts).
 *
 * A band whose first cell is covered by a merge from above (or from the
 * left) has no cell of its own to hang a grip in, and gets none: there is
 * nothing there to grab that would not be a lie about what it selects.
 *
 * What a press *opens* is the host's: the extension reports the band and the
 * grip's rect, and the app renders the menu (see the app's table-menu),
 * exactly as the block menu is arranged.
 *
 * Decorations are built when a table's *grid* changes and then mapped, the
 * way Notion and Tiptap keep their chrome off the keystroke path. Typing
 * inside a cell is not a grid change — the widgets stay the same DOM nodes,
 * so a pointer resting on a grip is never rebuilt out from under itself.
 * The expanded state is a cheap attribute write on those nodes, not a
 * decoration rebuild: `aria-expanded` is what the stylesheet (and a screen
 * reader) already keys off.
 */
export const createTableHandles = (options: TableHandlesOptions): FunctionalExtension => {
  const label =
    options.label ?? ((kind: 'row' | 'column', number: number) => `${kind} ${number} options`);

  const grip = (view: EditorView, kind: 'row' | 'column', index: number): HTMLElement => {
    const el = document.createElement('span');
    el.className = `aee-grip aee-grip--${kind}`;
    el.dataset['index'] = String(index);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label(kind, index + 1));
    el.setAttribute('title', label(kind, index + 1));
    // What the grip *is*, said in ARIA rather than in a class: a button that
    // opens a menu, expanded for as long as that menu has the band — which
    // is what keeps it on screen when the pointer leaves for the menu
    // (styles.scss reads the attribute, nothing else). The plugin view
    // writes this from the selection after every transaction; the widget
    // itself always starts collapsed so a rebuild cannot lie.
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.contentEditable = 'false';
    // Three dots — the handle's face everywhere else: ⋮ on a row's flank, ⋯
    // above a column. The middle one is the element, the other two its
    // pseudo-elements (styles.scss); the box around them is the target.
    el.appendChild(document.createElement('i'));
    // The press must not travel into the editor: a mousedown inside a cell
    // would put the caret there and collapse the band selection the click is
    // about to make.
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('click', (event) => {
      event.preventDefault();
      // Measured on the element the pointer is on, before the selection
      // transaction runs — even though that transaction no longer remounts
      // the grip, this is still the honest moment: the rect of *this* press.
      const boundingBox = el.getBoundingClientRect();
      // The table's position is read off the document, not closed over when
      // the widget was built: decorations map through edits above the table
      // and the same element stays in the document, so a captured pos would
      // quietly point at the wrong place.
      const tablePos = tablePosOf(view, el);
      if (tablePos < 0) return;
      const select = kind === 'row' ? selectRow : selectColumn;
      if (!select(tablePos, index)(view.state, view.dispatch)) return;
      options.onOpen({ kind, index, tablePos, boundingBox });
    });
    return el;
  };

  return defineExtension({
    name: 'tableHandles',
    plugins: () => [
      new Plugin<TableHandlesState>({
        key: tableHandlesKey,
        state: {
          init: (_, state) => buildState(state, grip, 0),
          apply: (tr, prev, _old, state) => applyHandles(tr, prev, state, grip),
        },
        props: {
          decorations: (state) => tableHandlesKey.getState(state)?.decorations,
        },
        view: (view) => {
          let lastGeneration = -1;
          let lastBand = '';
          const sync = () => {
            const plugin = tableHandlesKey.getState(view.state);
            const band = selectedBand(view.state.selection);
            const caret = caretCell(view.state.selection);
            const key = [
              band ? `${band.tablePos}:${band.kind}:${band.from}:${band.to}` : '',
              caret ? `${caret.tablePos}:${caret.row}:${caret.column}` : '',
            ].join('|');
            if (plugin?.generation === lastGeneration && key === lastBand) return;
            lastGeneration = plugin?.generation ?? 0;
            lastBand = key;
            view.dom
              .querySelectorAll<HTMLElement>('.aee-grip[aria-expanded="true"]')
              .forEach((el) => {
                el.setAttribute('aria-expanded', 'false');
              });
            view.dom.querySelectorAll<HTMLElement>('.aee-grip[data-caret]').forEach((el) => {
              el.removeAttribute('data-caret');
            });
            // The caret's cell: its row's grip and its column's stay on
            // screen while it is typed in (the stylesheet shows `data-caret`).
            if (caret) {
              const table = view.nodeDOM(caret.tablePos);
              if (table instanceof HTMLElement) {
                table
                  .querySelector<HTMLElement>(`.aee-grip--row[data-index="${caret.row}"]`)
                  ?.setAttribute('data-caret', '');
                table
                  .querySelector<HTMLElement>(`.aee-grip--column[data-index="${caret.column}"]`)
                  ?.setAttribute('data-caret', '');
              }
            }
            if (!band) return;
            const table = view.nodeDOM(band.tablePos);
            if (!(table instanceof HTMLElement)) return;
            for (let index = band.from; index < band.to; index++) {
              table
                .querySelector<HTMLElement>(`.aee-grip--${band.kind}[data-index="${index}"]`)
                ?.setAttribute('aria-expanded', 'true');
            }
          };
          sync();
          return { update: sync };
        },
      }),
    ],
  });
};

function applyHandles(
  tr: Transaction,
  prev: TableHandlesState,
  state: EditorState,
  grip: (view: EditorView, kind: 'row' | 'column', index: number) => HTMLElement,
): TableHandlesState {
  if (!tr.docChanged) return prev;

  const mapped: { pos: number; node: Node }[] = [];
  for (const table of prev.tables) {
    const pos = tr.mapping.map(table.pos);
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'table' || !sameTableGrid(table.node, node)) {
      return buildState(state, grip, prev.generation + 1);
    }
    mapped.push({ pos, node });
  }

  let count = 0;
  forEachTable(state.doc, () => {
    count++;
  });
  if (count !== mapped.length) return buildState(state, grip, prev.generation + 1);

  // Typing maps cleanly. A resize commit (`setNodeMarkup` on every cell,
  // so the new widths stick) does not: ProseMirror drops node decorations
  // that sat on the replaced cells, and those are the `data-col` marks the
  // column grips light up from. If the set shrank, the cheap path lied —
  // rebuild. Widget identity is kept by the same keys either way.
  const decorations = prev.decorations.map(tr.mapping, state.doc);
  if (decorations.find().length !== prev.decorations.find().length) {
    return buildState(state, grip, prev.generation + 1);
  }
  return { decorations, tables: mapped, generation: prev.generation };
}

function buildState(
  state: EditorState,
  grip: (view: EditorView, kind: 'row' | 'column', index: number) => HTMLElement,
  generation: number,
): TableHandlesState {
  const decorations: Decoration[] = [];
  const tables: { pos: number; node: Node }[] = [];

  forEachTable(state.doc, (node, tablePos) => {
    tables.push({ pos: tablePos, node });
    const map = TableMap.get(node);
    const start = tablePos + 1;

    for (let row = 0; row < map.height; row++) {
      const cell = bandCell(map, 'row', row);
      if (cell === null) continue;
      decorations.push(
        Decoration.widget(start + cell + 1, (view) => grip(view, 'row', row), {
          // Stable across every re-render of the table, so a grip is never
          // rebuilt under the pointer that is on it. The expanded state is
          // not part of the key: that is an attribute write, not a remount.
          key: `row-grip-${tablePos}-${row}`,
          side: -1,
          ignoreSelection: true,
        }),
      );
    }

    // Which column each cell stands in — the stylesheet reveals the grip of
    // the column being pointed at, and CSS cannot count a grid through
    // merges on its own.
    for (let row = 0; row < map.height; row++) {
      for (let column = 0; column < map.width; column++) {
        if (!cellStartsAt(map, row, column)) continue;
        const rel = map.map[row * map.width + column];
        const size = node.nodeAt(rel)!.nodeSize;
        decorations.push(
          Decoration.node(start + rel, start + rel + size, {
            'data-col': String(column),
          }),
        );
      }
    }

    for (let column = 0; column < map.width; column++) {
      const cell = bandCell(map, 'column', column);
      if (cell === null) continue;
      decorations.push(
        Decoration.widget(start + cell + 1, (view) => grip(view, 'column', column), {
          key: `column-grip-${tablePos}-${column}`,
          side: -1,
          ignoreSelection: true,
        }),
      );
    }
  });

  return {
    decorations: decorations.length
      ? DecorationSet.create(state.doc, decorations)
      : DecorationSet.empty,
    tables,
    generation,
  };
}

/** The table a grip currently sits in, read from the live document. */
function tablePosOf(view: EditorView, el: HTMLElement): number {
  const from = el.closest('td') ?? el;
  const pos = view.posAtDOM(from, 0);
  const $pos = view.state.doc.resolve(Math.max(pos, 0));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'table') return $pos.before(depth);
  }
  return -1;
}

function forEachTable(doc: Node, fn: (node: Node, pos: number) => void): void {
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    fn(node, pos);
    return false;
  });
}

/**
 * Whether two table nodes describe the same grid — same rows, same cells,
 * same spans. ProseMirror's persistent tree keeps unchanged rows as the
 * *same object*, so a keystroke is one new cell and this returns in a
 * handful of identity compares.
 */
function sameTableGrid(a: Node, b: Node): boolean {
  if (a.childCount !== b.childCount) return false;
  for (let row = 0; row < a.childCount; row++) {
    const left = a.child(row);
    const right = b.child(row);
    if (left === right) continue;
    if (left.childCount !== right.childCount) return false;
    for (let column = 0; column < left.childCount; column++) {
      const from = left.child(column);
      const to = right.child(column);
      if (from === to) continue;
      if (from.attrs['colspan'] !== to.attrs['colspan']) return false;
      if (from.attrs['rowspan'] !== to.attrs['rowspan']) return false;
    }
  }
  return true;
}

/**
 * The band the selection *is*, where it is one of this table's: a whole row
 * (or rows), or a whole column — which is exactly what a grip's press makes,
 * and what the grip then reports as its expanded state. Anything else — a
 * caret, a rectangle of cells, another table's selection — is no band.
 */
/** The cell the caret is in — a text selection inside one cell — as its
    place in the grid: which row and column, of which table. Null for a
    cell selection (a band's own affair) and outside any table. */
function caretCell(selection: Selection): { tablePos: number; row: number; column: number } | null {
  if (selection instanceof CellSelection) return null;
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec['tableRole'] !== 'cell') continue;
    if (depth < 2) return null;
    const table = $from.node(depth - 2);
    if (table.type.spec['tableRole'] !== 'table') return null;
    const tableStart = $from.start(depth - 2);
    const rect = TableMap.get(table).findCell($from.before(depth) - tableStart);
    return { tablePos: tableStart - 1, row: rect.top, column: rect.left };
  }
  return null;
}

function selectedBand(
  selection: Selection,
): { kind: 'row' | 'column'; from: number; to: number; tablePos: number } | null {
  if (!(selection instanceof CellSelection)) return null;
  const table = selection.$anchorCell.node(-1);
  if (table.type.name !== 'table') return null;
  const tableStart = selection.$anchorCell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart,
  );
  // A grid-wide selection is both, and answers as neither: no single band is
  // the one being worked on.
  const isRow = selection.isRowSelection();
  const isColumn = selection.isColSelection();
  if (isRow === isColumn) return null;
  return isRow
    ? { kind: 'row', from: rect.top, to: rect.bottom, tablePos: tableStart - 1 }
    : { kind: 'column', from: rect.left, to: rect.right, tablePos: tableStart - 1 };
}

/**
 * The cell a band's grip hangs in: the first one along the band that
 * actually *starts* there — a cell merged in from above (or from the left)
 * belongs to an earlier band and would put the grip at the wrong height.
 * `null` where the whole band is covered by such merges.
 */
function bandCell(map: TableMap, kind: 'row' | 'column', index: number): number | null {
  const length = kind === 'row' ? map.width : map.height;
  for (let along = 0; along < length; along++) {
    const row = kind === 'row' ? index : along;
    const column = kind === 'row' ? along : index;
    if (cellStartsAt(map, row, column)) return map.map[row * map.width + column];
  }
  return null;
}

/** Whether the cell at (`row`, `column`) *begins* there, not merely covers
    it — the same question `TableMap.findCell` answers, without the scan. */
function cellStartsAt(map: TableMap, row: number, column: number): boolean {
  const rel = map.map[row * map.width + column];
  if (column > 0 && map.map[row * map.width + column - 1] === rel) return false;
  if (row > 0 && map.map[(row - 1) * map.width + column] === rel) return false;
  return true;
}
