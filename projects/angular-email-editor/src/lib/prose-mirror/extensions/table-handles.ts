import { EditorState, Plugin, PluginKey, Selection, Transaction } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { CellSelection, TableMap, cellAround } from 'prosemirror-tables';
import { FunctionalExtension, defineExtension } from '../extension';
import { closeHistory } from 'prosemirror-history';
import { moveTableBand, selectColumn, selectRow, tableKind } from './nodes/table';
import { layoutInteractive } from './layout-interaction';
import { holdDragCursor } from './drag-cursor';

/** Which band — or which cell — of which table a grip stands for, and
    where it is on screen. */
export interface TableHandleTarget {
  /** A band's grip, the caret cell's, or the table's own ring — its style. */
  kind: 'row' | 'column' | 'cell' | 'table';
  /** The band's index in the grid, counted from the top / the start; a
      cell's column. */
  index: number;
  /** A cell's row. */
  row?: number;
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
      the band's 1-based number, as a person counts rows; for the caret
      cell's grip, the cell's column. */
  label?: (kind: 'row' | 'column' | 'cell' | 'table', number: number) => string;
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

/** A band being dragged by its grip: which, of which table. */
interface BandMove {
  tablePos: number;
  kind: 'row' | 'column';
  index: number;
}

const bandMoveKey = new PluginKey<BandMove | null>('tableBandMove');

/** The class on each cell of a band being dragged by its grip — the host
    hides what is in it (Notion's: the band's text goes, its place stays). */
export const BAND_MOVING_CLASS = 'aee-band--moving';

/** The class of the line a grip's drag shows where its band would land —
    on the far edge of the band under the pointer: its right (or bottom)
    edge past the dragged band, its left (or top) edge before it.
    `aee-band-drop--column` / `--row` say which way it runs. The host
    paints it. */
export const BAND_DROP_CLASS = 'aee-band-drop';

/** The class of the band's copy a grip's drag carries along the table's
    axis under the pointer — Notion's preview: the band's own cells, its
    grip and selection on it. `aee-band-ghost--column` / `--row` say
    which. The host paints it (its opacity, its frame). */
export const BAND_GHOST_CLASS = 'aee-band-ghost';

/** How far, in px, a press on a grip moves before it is a drag. */
const MOVE_THRESHOLD = 4;

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
    options.label ??
    ((kind: 'row' | 'column' | 'cell' | 'table', number: number) =>
      kind === 'cell'
        ? 'Cell options'
        : kind === 'table'
          ? 'Table style'
          : `${kind} ${number} options`);

  /** The caret cell's own grip: Notion's — a pill on the cell's right edge
      that opens the cell's menu — fill, alignment, clearing — the caret
      staying where it is. It sits on the column boundary, so a press there
      is the grip's, never a resize; *dragged*, it selects from its cell to
      the cell under the pointer, the way a press-and-drag across cells
      does, and opens nothing. Selection-driven, so it is built afresh as the
      caret moves and never rebuilt while a cell is typed in (its key is the
      cell). */
  const cellGrip = (view: EditorView, cell: CaretCell): HTMLElement => {
    const el = document.createElement('span');
    el.className = 'aee-grip aee-grip--cell';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label('cell', cell.column + 1));
    el.setAttribute('title', label('cell', cell.column + 1));
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.contentEditable = 'false';
    // ⋮, as on a row's grip: the middle dot and its two pseudo-elements.
    el.appendChild(document.createElement('i'));
    let dragged = false;
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      // Not the editor's: it would move the caret, and the boundary line's
      // own press under the grip would start a resize.
      event.stopPropagation();
      if (event.button !== 0) return;
      dragged = false;
      const anchor = cell.pos;
      // Said on the table's wrap for the drag's lifetime: the boundary lines
      // it crosses are not being resized, so they neither light nor take the
      // pointer (styles.scss). The grip itself goes once the selection is a
      // range, so the wrap is the one element that outlives it.
      const wrap = el.closest<HTMLElement>('.aee-table-wrap');
      wrap?.setAttribute('data-cell-drag', '');
      const move = (moved: MouseEvent) => {
        const head = cellAt(view, moved, anchor);
        if (head === null || (!dragged && head === anchor)) return;
        dragged = true;
        const { doc } = view.state;
        const selection = view.state.selection;
        if (
          selection instanceof CellSelection &&
          selection.$anchorCell.pos === anchor &&
          selection.$headCell.pos === head
        ) {
          return;
        }
        view.dispatch(view.state.tr.setSelection(CellSelection.create(doc, anchor, head)));
      };
      const up = () => {
        wrap?.removeAttribute('data-cell-drag');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // A drag that came back to its grip is still a drag.
      if (dragged) {
        dragged = false;
        return;
      }
      el.setAttribute('aria-expanded', 'true');
      options.onOpen({
        kind: 'cell',
        index: cell.column,
        row: cell.row,
        tablePos: cell.tablePos,
        boundingBox: el.getBoundingClientRect(),
      });
    });
    return el;
  };

  /** The table's own ring, on its top-left corner: a dot that opens to a
      ring (the host's `.aee-grip--table`) and opens the host's menu for the
      table's style. A press leaves the caret and the selection as they are:
      the style command takes the table's position. */
  const ring = (view: EditorView): HTMLElement => {
    const el = document.createElement('span');
    el.className = 'aee-grip aee-grip--table';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label('table', 1));
    el.setAttribute('title', label('table', 1));
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.contentEditable = 'false';
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const tablePos = tablePosOf(view, el);
      if (tablePos < 0) return;
      el.setAttribute('aria-expanded', 'true');
      // The menu hands the focus back to the text when it is done.
      view.dom.addEventListener('focus', () => el.setAttribute('aria-expanded', 'false'), {
        once: true,
      });
      options.onOpen({ kind: 'table', index: 0, tablePos, boundingBox: el.getBoundingClientRect() });
    });
    return el;
  };

  const grip = (view: EditorView, kind: 'row' | 'column' | 'table', index: number): HTMLElement => {
    if (kind === 'table') return ring(view);
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
    // about to make. Dragged, the press moves its band instead
    // (`startBandMove`); one that stays put is the click below.
    let dragged = false;
    el.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (event.button !== 0) return;
      dragged = false;
      startBandMove(view, el, kind, index, event, () => (dragged = true));
    });
    el.addEventListener('click', (event) => {
      event.preventDefault();
      // A drag that came back to its grip is still a drag.
      if (dragged) {
        dragged = false;
        return;
      }
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

  // The grips a static switch leaves — off every layout table. The last
  // answer is kept until the plugin state moves (a doc change): `decorations`
  // runs on every update, a caret move included.
  let shown: { handles: TableHandlesState; result: DecorationSet } | null = null;
  const interactiveGrips = (handles: TableHandlesState): DecorationSet => {
    if (shown?.handles === handles) return shown.result;
    let result = handles.decorations;
    for (const { pos, node } of handles.tables) {
      if (tableKind(node) !== 'layout') continue;
      result = result.remove(result.find(pos, pos + node.nodeSize));
    }
    shown = { handles, result };
    return result;
  };

  return defineExtension({
    name: 'tableHandles',
    plugins: () => [
      // The band a grip is dragging: each of its cells marked, so the host
      // can hide what is in it while the drop line shows where it goes.
      new Plugin<BandMove | null>({
        key: bandMoveKey,
        state: {
          init: () => null,
          apply: (tr, moving) => {
            const meta = tr.getMeta(bandMoveKey) as BandMove | null | undefined;
            if (meta !== undefined) return meta;
            return moving && tr.docChanged ? null : moving;
          },
        },
        props: {
          decorations: (state) => {
            const moving = bandMoveKey.getState(state);
            const table = moving ? state.doc.nodeAt(moving.tablePos) : null;
            if (!moving || !table || table.type.name !== 'table') return null;
            const map = TableMap.get(table);
            const cells = new Set<number>();
            const across = moving.kind === 'row' ? map.width : map.height;
            for (let i = 0; i < across; i++) {
              const row = moving.kind === 'row' ? moving.index : i;
              const column = moving.kind === 'row' ? i : moving.index;
              cells.add(map.map[row * map.width + column]);
            }
            return DecorationSet.create(
              state.doc,
              [...cells].map((rel) => {
                const pos = moving.tablePos + 1 + rel;
                return Decoration.node(pos, pos + table.nodeAt(rel)!.nodeSize, {
                  class: BAND_MOVING_CLASS,
                });
              }),
            );
          },
        },
      }),
      new Plugin<TableHandlesState>({
        key: tableHandlesKey,
        state: {
          init: (_, state) => buildState(state, grip, 0),
          apply: (tr, prev, _old, state) => applyHandles(tr, prev, state, grip),
        },
        props: {
          decorations: (state) => {
            const handles = tableHandlesKey.getState(state);
            if (!handles) return DecorationSet.empty;
            // Layout tables static (`setLayoutInteraction`): no grip on one
            // to press — a bordered or borderless table keeps all of its.
            const on = layoutInteractive(state, 'table');
            const set = on ? handles.decorations : interactiveGrips(handles);
            const cell = caretCell(state.selection);
            if (!cell || (!on && cell.layout)) return set;
            return set.add(state.doc, [
              Decoration.widget(cell.pos + 1, (view) => cellGrip(view, cell), {
                key: `cell-grip-${cell.pos}`,
                side: -1,
                ignoreSelection: true,
              }),
            ]);
          },
        },
        view: (view) => {
          let lastGeneration = -1;
          let lastBand = '';
          let interactive = layoutInteractive(view.state, 'table');
          const sync = () => {
            // Switched off under an open menu: the grip it hangs from is gone.
            const now = layoutInteractive(view.state, 'table');
            if (interactive && !now) options.onOpen(null);
            interactive = now;
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

/**
 * Notion's drag-to-move, from a row or column grip. Past a few pixels the
 * press is a drag: the band's cells are marked (`BAND_MOVING_CLASS`, the
 * host hides what is in them) and nothing else moves; the band under the
 * pointer — the whole band, never half of it — decides where it lands, and
 * a line (`BAND_DROP_CLASS`) says so on that band's far edge: after it when
 * it lies past the dragged one, before it when it lies ahead. Over its own
 * band, or where a merged cell would be crossed, there is no line, and a
 * release there changes nothing. Release moves the band (`moveTableBand`)
 * as one undo step; Escape lets it go untouched.
 *
 * What the hand holds goes with it, as Notion's does: a copy of the band
 * (`BAND_GHOST_CLASS` — its cells, their lines and fill, its grip held
 * open, the caret's frame if it is in there) slides along the table's axis
 * under the pointer, kept where it was grabbed; and the cursor is
 * `grabbing` wherever the pointer goes (`holdDragCursor`).
 *
 * The bands' extents are read once, at the drag's start, off a cell of each
 * band's own — the one measured thing, as with the marquee: a pointer has
 * no other geometry.
 */
function startBandMove(
  view: EditorView,
  grip: HTMLElement,
  kind: 'row' | 'column',
  index: number,
  event: MouseEvent,
  onDrag: () => void,
): void {
  const column = kind === 'column';
  const origin = { x: event.clientX, y: event.clientY };
  let releaseCursor: (() => void) | null = null;
  let ghost: HTMLElement | null = null;
  let grabbed = 0;
  let tablePos = -1;
  let bands: { start: number; end: number }[] = [];
  let target = index;
  let fits = false;
  let dragging = false;
  let wrap: HTMLElement | null = null;
  let tableEl: HTMLElement | null = null;
  let line: HTMLElement | null = null;

  const begin = (): boolean => {
    tablePos = tablePosOf(view, grip);
    tableEl = grip.closest('table');
    wrap = grip.closest<HTMLElement>('.aee-table-wrap') ?? tableEl?.parentElement ?? null;
    const table = tablePos >= 0 ? view.state.doc.nodeAt(tablePos) : null;
    if (!table || !tableEl || !wrap) return false;
    bands = bandExtents(view, table, tablePos, kind);
    if (!bands.length) return false;
    dragging = true;
    onDrag();
    // The copy first, while the band's cells are still as they look.
    ghost = bandGhost(view, table, tablePos, kind, index, tableEl);
    wrap.appendChild(ghost);
    grabbed = (column ? origin.x : origin.y) - bands[index].start;
    view.dispatch(view.state.tr.setMeta(bandMoveKey, { tablePos, kind, index }));
    line = document.createElement('div');
    line.className = `${BAND_DROP_CLASS} ${BAND_DROP_CLASS}--${kind}`;
    line.setAttribute('aria-hidden', 'true');
    line.style.position = 'absolute';
    line.style.display = 'none';
    // On the table's wrap: the table view's own ground, never the content.
    wrap.appendChild(line);
    releaseCursor = holdDragCursor('grabbing');
    return true;
  };

  /** The copy under the pointer, along the axis, where it was grabbed. */
  const carry = (at: number) => {
    if (!ghost || !wrap || !tableEl) return;
    const box = wrap.getBoundingClientRect();
    const table = tableEl.getBoundingClientRect();
    if (column) {
      ghost.style.left = `${at - grabbed - box.left}px`;
      ghost.style.top = `${table.top - box.top}px`;
    } else {
      ghost.style.top = `${at - grabbed - box.top}px`;
      ghost.style.left = `${table.left - box.left}px`;
    }
  };

  const place = (at: number) => {
    // The band under the pointer — past either end, the end one.
    const over = bands.findIndex((band) => at < band.end);
    target = over < 0 ? bands.length - 1 : over;
    fits = target !== index && moveTableBand(tablePos, kind, index, target)(view.state);
    if (!line || !wrap || !tableEl) return;
    if (!fits) {
      line.style.display = 'none';
      return;
    }
    const edge = target > index ? bands[target].end : bands[target].start;
    const box = wrap.getBoundingClientRect();
    const table = tableEl.getBoundingClientRect();
    line.style.display = '';
    if (column) {
      line.style.left = `${edge - box.left}px`;
      line.style.top = `${table.top - box.top}px`;
      line.style.height = `${table.height}px`;
    } else {
      line.style.top = `${edge - box.top}px`;
      line.style.left = `${table.left - box.left}px`;
      line.style.width = `${table.width}px`;
    }
  };

  const finish = (commit: boolean) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    window.removeEventListener('keydown', key, true);
    if (!dragging) return;
    releaseCursor?.();
    line?.remove();
    ghost?.remove();
    if (view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(bandMoveKey, null));
    if (commit && fits) {
      // Its own step, never folded into the typing just before it.
      moveTableBand(tablePos, kind, index, target)(view.state, (tr) =>
        view.dispatch(closeHistory(tr)),
      );
    }
  };
  const move = (moved: MouseEvent) => {
    if (view.isDestroyed) return finish(false);
    if (!dragging) {
      const far =
        Math.abs(moved.clientX - origin.x) >= MOVE_THRESHOLD ||
        Math.abs(moved.clientY - origin.y) >= MOVE_THRESHOLD;
      if (!far) return;
      if (!begin()) return finish(false);
    }
    const at = column ? moved.clientX : moved.clientY;
    carry(at);
    place(at);
  };
  const up = () => finish(true);
  const key = (pressed: KeyboardEvent) => {
    if (pressed.key !== 'Escape' || !dragging) return;
    pressed.preventDefault();
    pressed.stopPropagation();
    finish(false);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  window.addEventListener('keydown', key, true);
}

/**
 * The band's copy for a drag: its own cells, cloned as they are drawn —
 * padding, lines, fill, the caret's frame — in a table of their own, each
 * row (or cell) as tall (or wide) as the original, so it reads as the band
 * lifted out. Only the dragged grip stays in it, held open; every other
 * grip, and anything that could take the pointer or the caret, is left out.
 */
function bandGhost(
  view: EditorView,
  table: Node,
  tablePos: number,
  kind: 'row' | 'column',
  index: number,
  tableEl: HTMLElement,
): HTMLElement {
  const map = TableMap.get(table);
  const ghost = document.createElement('div');
  ghost.className = `${BAND_GHOST_CLASS} ${BAND_GHOST_CLASS}--${kind}`;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.contentEditable = 'false';
  ghost.style.position = 'absolute';
  ghost.style.pointerEvents = 'none';
  const copy = ghost.appendChild(document.createElement('table'));
  copy.setAttribute('role', 'presentation');
  copy.style.borderCollapse = getComputedStyle(tableEl).borderCollapse;
  copy.style.tableLayout = 'fixed';
  const body = copy.appendChild(document.createElement('tbody'));
  const rows = tableEl.querySelectorAll<HTMLElement>(':scope > tbody > tr, :scope > tr');
  const clone = (rel: number): HTMLElement | null => {
    const cell = view.nodeDOM(tablePos + 1 + rel);
    if (!(cell instanceof HTMLElement)) return null;
    const twin = cell.cloneNode(true) as HTMLElement;
    twin.classList.remove(BAND_MOVING_CLASS);
    twin.querySelectorAll<HTMLElement>('.aee-grip').forEach((grip) => {
      const own = grip.classList.contains(`aee-grip--${kind}`) && grip.dataset['index'] === String(index);
      if (own) grip.setAttribute('aria-expanded', 'true');
      else grip.remove();
    });
    return twin;
  };
  if (kind === 'column') {
    let width = 0;
    for (let row = 0; row < map.height; row++) {
      const rel = map.map[row * map.width + index];
      const twin = clone(rel);
      const tr = body.appendChild(document.createElement('tr'));
      const height = rows[row]?.getBoundingClientRect().height;
      if (height) tr.style.height = `${height}px`;
      if (twin) {
        width ||= (view.nodeDOM(tablePos + 1 + rel) as HTMLElement).getBoundingClientRect().width;
        tr.appendChild(twin);
      }
    }
    copy.style.width = `${width}px`;
  } else {
    const tr = body.appendChild(document.createElement('tr'));
    const seen = new Set<number>();
    for (let column = 0; column < map.width; column++) {
      const rel = map.map[index * map.width + column];
      if (seen.has(rel)) continue;
      seen.add(rel);
      const twin = clone(rel);
      if (!twin) continue;
      twin.style.width = `${(view.nodeDOM(tablePos + 1 + rel) as HTMLElement).getBoundingClientRect().width}px`;
      tr.appendChild(twin);
    }
    copy.style.width = `${tableEl.getBoundingClientRect().width}px`;
    const height = rows[index]?.getBoundingClientRect().height;
    if (height) tr.style.height = `${height}px`;
  }
  return ghost;
}

/** Each band's extent on screen along the drag, in client px — a column's
    left and right, a row's top and bottom — read off a cell of the band's
    own (one spanning no other band). None, when a band has no such cell. */
function bandExtents(
  view: EditorView,
  table: Node,
  tablePos: number,
  kind: 'row' | 'column',
): { start: number; end: number }[] {
  const map = TableMap.get(table);
  const count = kind === 'row' ? map.height : map.width;
  const across = kind === 'row' ? map.width : map.height;
  const out: { start: number; end: number }[] = [];
  for (let band = 0; band < count; band++) {
    let found: { start: number; end: number } | null = null;
    for (let i = 0; i < across && !found; i++) {
      const row = kind === 'row' ? band : i;
      const column = kind === 'row' ? i : band;
      const rel = map.map[row * map.width + column];
      const rect = map.findCell(rel);
      const span = kind === 'row' ? rect.bottom - rect.top : rect.right - rect.left;
      if (span !== 1) continue;
      const dom = view.nodeDOM(tablePos + 1 + rel);
      if (!(dom instanceof HTMLElement)) continue;
      const box = dom.getBoundingClientRect();
      found = kind === 'row' ? { start: box.top, end: box.bottom } : { start: box.left, end: box.right };
    }
    if (!found) return [];
    out.push(found);
  }
  return out;
}

function applyHandles(
  tr: Transaction,
  prev: TableHandlesState,
  state: EditorState,
  grip: (view: EditorView, kind: 'row' | 'column' | 'table', index: number) => HTMLElement,
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
  grip: (view: EditorView, kind: 'row' | 'column' | 'table', index: number) => HTMLElement,
  generation: number,
): TableHandlesState {
  const decorations: Decoration[] = [];
  const tables: { pos: number; node: Node }[] = [];

  forEachTable(state.doc, (node, tablePos) => {
    tables.push({ pos: tablePos, node });
    const map = TableMap.get(node);
    const start = tablePos + 1;

    // The table's ring, in its first cell, on that cell's top-left corner —
    // the table's.
    decorations.push(
      Decoration.widget(start + map.map[0] + 1, (view) => grip(view, 'table', 0), {
        key: `table-ring-${tablePos}`,
        side: -1,
        ignoreSelection: true,
      }),
    );

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

/** The cell under the pointer, as its node's position — only in the table
    `anchor` (a cell's position) stands in; null anywhere else, so a drag
    out of the table keeps the last cell it was over. */
function cellAt(view: EditorView, event: MouseEvent, anchor: number): number | null {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return null;
  const { doc } = view.state;
  const $cell = cellAround(doc.resolve(found.pos));
  if (!$cell) return null;
  return $cell.start(-1) === doc.resolve(anchor).start(-1) ? $cell.pos : null;
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
interface CaretCell {
  tablePos: number;
  row: number;
  column: number;
  /** The cell node's position in the document. */
  pos: number;
  /** Whether its table is a layout table (`tableKind`). */
  layout: boolean;
}

function caretCell(selection: Selection): CaretCell | null {
  if (selection instanceof CellSelection) return null;
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec['tableRole'] !== 'cell') continue;
    if (depth < 2) return null;
    const table = $from.node(depth - 2);
    if (table.type.spec['tableRole'] !== 'table') return null;
    const tableStart = $from.start(depth - 2);
    const pos = $from.before(depth);
    const rect = TableMap.get(table).findCell(pos - tableStart);
    return {
      tablePos: tableStart - 1,
      row: rect.top,
      column: rect.left,
      pos,
      layout: tableKind(table) === 'layout',
    };
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
