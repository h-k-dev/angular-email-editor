import { applyAuthoredAttributes } from '../authored';
import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView, ViewMutationRecord } from 'prosemirror-view';
import { CellSelection, TableMap } from 'prosemirror-tables';
import { closeHistory } from 'prosemirror-history';
import { holdDragCursor } from './drag-cursor';
import { defineExtension } from '../extension';
import { layoutBlockInteractive } from './layout-interaction';
import {
  MIN_COLUMN_PCT,
  MIN_TABLE_PCT,
  TABLE_COLUMNS,
  addColumnAtEnd,
  addRowAtEnd,
  formatPct,
  isTableEmpty,
  removeEmptyLastColumn,
  removeEmptyLastRow,
  tableKind,
  tableStyle,
} from './nodes/table';

/**
 * Column resize — drag the boundary between two columns, in percentages.
 *
 * The reference UX is Tiptap's (hover a boundary, a primary-coloured line
 * lights up, drag it), but its mechanism can't ship in email, so ours differs
 * under the skin in exactly the ways the ROADMAP's responsiveness ledger
 * demands:
 *
 *  - **Percentages, never pixels.** Tiptap commits `colwidth="137"` (px) and a
 *    px `<colgroup>`; a fixed-px column is the ledger's central trap. Our drag
 *    commits percentages into the same `colwidth` attr, and the email carries
 *    them as `width: n%` *on the cells* — the one place every client honours a
 *    width — while staying fluid at every viewport.
 *  - **Everything visual is editor furniture.** The table's NodeView renders
 *    `div.aee-table-wrap > table (colgroup + tbody) + div.aee-col-lines`: a
 *    scroll wrapper, a display colgroup the drag previews against, and one
 *    full-height boundary line per draggable boundary. None of it serializes —
 *    the schema's `toDOM` (which also feeds the clipboard) stays the bare
 *    canonical table.
 *  - **No per-column px minimum.** Tiptap floors columns at 120px; px again.
 *    The drag clamps at {@link MIN_COLUMN_PCT} instead — at 320px that is
 *    ~32px, and a column resized to 15% *is* 15% on a phone. Honest fluidity.
 *
 * The boundary lines are the payoff of the percentage model: their positions
 * are *computed from the document* (`left` = the cumulative column share), so
 * a full-height line exists per boundary with zero measurement and zero
 * pointer tracking — hovering anywhere along the boundary lights the whole
 * line, because the line is one element, not a per-cell segment. Only the
 * drag itself follows the pointer (a drag *is* a pointer gesture), and its
 * move/up listeners live on `window` for its duration, so the pointer can
 * never outrun the handle and stutter.
 *
 * **The drag is a deferred commit, Word-style: only the guide line moves.**
 * We tried live reflow first (previewing through the colgroup) and the
 * tracking was perfect — and unusable: reflowing the table on every
 * pointermove rewraps its text on every frame, and the whole grid churns
 * under the hand. So mid-drag the table does not move at all; the lit line is
 * the preview (its clamp stops it at the 10% floors, so the limits read
 * directly off it), and release applies one rounded transaction — the table
 * lays out exactly once, and the drag is one undo step.
 */
const columnResizeKey = new PluginKey<DecorationSet>('columnResize');

export const ColumnResize = defineExtension({
  name: 'columnResize',
  plugins: () => [
    new Plugin<DecorationSet>({
      key: columnResizeKey,
      state: {
        init: (_, state) => selectionDecorations(state),
        apply: (tr, decorations, _old, state) => {
          // Selection chrome is a handful of node decorations. Typing maps
          // them; a caret or cell-selection change rebuilds them. Building
          // a new set on every keystroke is the thing Tiptap's table view
          // refuses to do, and so do we.
          if (!tr.docChanged && !tr.selectionSet) return decorations;
          if (tr.docChanged && !tr.selectionSet) {
            const mapped = decorations.map(tr.mapping, state.doc);
            // A resize rewrites cell markup and mapping drops the node
            // decorations that sat on those cells (the selection rectangle,
            // the last-row/column classes). Rebuild when the set shrank.
            if (mapped.find().length === decorations.find().length) return mapped;
          }
          return selectionDecorations(state);
        },
      },
      props: {
        nodeViews: {
          table: (node, view, getPos) => new TableView(node, view, getPos as () => number),
        },
        decorations: (state) => columnResizeKey.getState(state),
      },
    }),
  ],
});

export { MIN_COLUMN_PCT, MIN_TABLE_PCT } from './nodes/table';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The declared width of each grid column (`null` = unspecified, shares the
    leftover) — read from the first cell in the column that declares one. */
export function columnWidths(table: Node): (number | null)[] {
  const map = TableMap.get(table);
  const widths: (number | null)[] = Array.from({ length: map.width }, () => null);
  for (let col = 0; col < map.width; col++) {
    for (let row = 0; row < map.height; row++) {
      const rel = map.map[row * map.width + col];
      const cell = table.nodeAt(rel)!;
      const colwidth = cell.attrs['colwidth'] as number[] | null;
      if (!colwidth) continue;
      const entry = colwidth[col - map.findCell(rel).left];
      // 0 is the library's padding for freshly spanned columns — "no width",
      // not "zero width"; a zero-wide column would render as deleted.
      if (entry) {
        widths[col] = entry;
        break;
      }
    }
  }
  return widths;
}

/** Every column's effective share, normalized to sum to 100: declared widths
    as declared, undeclared columns splitting the leftover equally — the same
    distribution fixed layout uses, so these numbers *are* the pixels and the
    boundary lines can be placed by pure arithmetic. */
export function effectiveWidths(table: Node): number[] {
  const declared = columnWidths(table);
  const specified = declared.filter((width): width is number => width != null);
  const leftover = Math.max(100 - specified.reduce((total, width) => total + width, 0), 0);
  const share = leftover / Math.max(declared.length - specified.length, 1);
  const raw = declared.map((width) => width ?? share);
  // Foreign markup can declare widths summing past 100; browsers scale
  // proportionally, and so do we, so the lines stay on the real boundaries.
  const total = raw.reduce((sum, width) => sum + width, 0) || 1;
  return raw.map((width) => (width / total) * 100);
}

/**
 * Sets the widths of the two columns meeting at `boundary` (the line between
 * grid columns `boundary` and `boundary + 1`) — what a resize drag commits.
 * `leftPct` is the left column's new share; the pair's total is conserved, so
 * only these two columns move. Clamped so neither side drops below
 * {@link MIN_COLUMN_PCT}. Every cell touching the two columns gets its
 * `colwidth` entries set (spans included, sum-preserving), so the widths
 * survive first-row edits and row deletion alike.
 */
export function setColumnBoundary(tablePos: number, boundary: number, leftPct: number): Command {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== 'table') return false;
    const map = TableMap.get(table);
    if (boundary < 0 || boundary >= map.width - 1) return false;

    const effective = effectiveWidths(table);
    const pair = effective[boundary] + effective[boundary + 1];
    if (pair < MIN_COLUMN_PCT * 2) return false;
    const left = round1(clamp(leftPct, MIN_COLUMN_PCT, pair - MIN_COLUMN_PCT));
    const right = round1(pair - left);

    if (dispatch) {
      const tr = state.tr;
      const patched = new Map<number, number[]>();
      for (const col of [boundary, boundary + 1]) {
        for (let row = 0; row < map.height; row++) {
          const rel = map.map[row * map.width + col];
          const cell = table.nodeAt(rel)!;
          const start = map.findCell(rel).left;
          // A spanned cell gets a full array (missing entries materialize at
          // their current effective width) so the one entry can move while the
          // others hold still.
          const colwidth =
            patched.get(rel) ??
            (cell.attrs['colwidth'] as number[] | null)?.slice() ??
            effective.slice(start, start + (cell.attrs['colspan'] as number)).map(round1);
          colwidth[col - start] = col === boundary ? left : right;
          patched.set(rel, colwidth);
        }
      }
      for (const [rel, colwidth] of patched) {
        const cell = table.nodeAt(rel)!;
        tr.setNodeMarkup(tablePos + 1 + rel, null, { ...cell.attrs, colwidth });
      }
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Sets the table's box — left offset and width, both percent of the
 * container — what dragging either outer edge commits. The left edge moves
 * the offset (the right edge stays put), the right edge moves the width;
 * the pair clamps so the offset stays ≥ 0, the width keeps its floor, and
 * together they never pass 100.
 *
 * `absorb` is the Word rule that keeps columns independent of the table's
 * edges: column widths are percentages *of the table*, so changing the table
 * width would slide every interior boundary proportionally. With `absorb`,
 * the edge-adjacent column ('first' for a left-edge drag, 'last' for a
 * right-edge one) takes the entire change and every other column is rescaled
 * by oldWidth/newWidth — same absolute size, boundaries exactly where they
 * were (to the 0.1% rounding). The width additionally floors where the
 * absorbing column would hit {@link MIN_COLUMN_PCT}. Without `absorb`,
 * columns scale proportionally.
 */
export function setTableBox(
  tablePos: number,
  offsetPct: number,
  widthPct: number,
  absorb?: 'first' | 'last',
): Command {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== 'table') return false;
    const map = TableMap.get(table);
    const oldWidth = table.attrs['width'] as number;

    const offset = round1(clamp(offsetPct, 0, 100 - MIN_TABLE_PCT));
    let width = round1(clamp(widthPct, MIN_TABLE_PCT, 100 - offset));

    if (dispatch) {
      const tr = state.tr;
      if (absorb && map.width > 1) {
        const effective = effectiveWidths(table);
        const absorbIndex = absorb === 'first' ? 0 : map.width - 1;
        const others = 100 - effective[absorbIndex];
        width = round1(clamp(width, minTableWidth(oldWidth, others), 100 - offset));
        const factor = oldWidth / width;
        const pcts = effective.map((pct, index) =>
          index === absorbIndex ? 0 : round1(pct * factor),
        );
        pcts[absorbIndex] = round1(100 - pcts.reduce((sum, pct) => sum + pct, 0));

        const seen = new Set<number>();
        for (const rel of map.map) {
          if (seen.has(rel)) continue;
          seen.add(rel);
          const cell = table.nodeAt(rel)!;
          const left = map.findCell(rel).left;
          const colwidth = pcts.slice(left, left + (cell.attrs['colspan'] as number));
          tr.setNodeMarkup(tablePos + 1 + rel, null, { ...cell.attrs, colwidth });
        }
      }
      tr.setNodeMarkup(tablePos, null, { ...table.attrs, offset, width });
      dispatch(tr);
    }
    return true;
  };
}

/** The narrowest the table may get while its non-absorbing columns keep
    their absolute widths and the absorbing one keeps the column floor. */
function minTableWidth(oldWidth: number, othersPct: number): number {
  return Math.max(MIN_TABLE_PCT, round1((oldWidth * othersPct) / (100 - MIN_COLUMN_PCT)));
}

/** Width-only convenience over {@link setTableBox}: keeps the offset. */
export function setTableWidth(tablePos: number, widthPct: number): Command {
  return (state, dispatch) => {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type.name !== 'table') return false;
    return setTableBox(tablePos, table.attrs['offset'] as number, widthPct)(state, dispatch);
  };
}

/**
 * Edge classes for the cells on a cell selection's boundary, so CSS can draw
 * the selection as *one object* — a crisp rectangle around the whole selected
 * region, Tiptap-style — without Tiptap's machinery. Their overlay is a
 * floating portal positioned by pixel measurement; ours needs none of it: a
 * `CellSelection` is always a rectangle in the `TableMap`, so every selected
 * cell knows from the model alone which of its edges lie on the boundary,
 * and per-cell border segments assemble into the rectangle by themselves.
 */
function selectionDecorations(state: EditorState): DecorationSet {
  const decorations = selectionEdgeDecorations(state);
  const marked = tableEdgeDecoration(state);
  if (marked) decorations.push(marked);
  const active = activeCellDecoration(state);
  if (active) decorations.push(active);
  return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
}

function selectionEdgeDecorations(state: EditorState): Decoration[] {
  const selection = state.selection;
  if (!(selection instanceof CellSelection)) return [];
  const table = selection.$anchorCell.node(-1);
  const tableStart = selection.$anchorCell.start(-1);
  const map = TableMap.get(table);
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart,
  );

  const decorations: Decoration[] = [];
  const seen = new Set<number>();
  for (const rel of map.cellsInRect(rect)) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const cell = table.nodeAt(rel)!;
    const box = map.findCell(rel);
    const classes = [
      box.top === rect.top ? 'aee-sel-top' : '',
      box.bottom === rect.bottom ? 'aee-sel-bottom' : '',
      box.left === rect.left ? 'aee-sel-left' : '',
      box.right === rect.right ? 'aee-sel-right' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (classes) {
      decorations.push(
        Decoration.node(tableStart + rel, tableStart + rel + cell.nodeSize, { class: classes }),
      );
    }
  }
  return decorations;
}

/** A node decoration outlining the caret's cell — the selection rectangle's
    quiet sibling (same outline, none of the tint), so the cell being typed in
    is always visible. Text cursor or in-cell text selection only: a cell
    selection draws the real rectangle instead. */
function activeCellDecoration(state: EditorState): Decoration | null {
  const selection = state.selection;
  if (selection instanceof CellSelection) return null;
  const { $from, $to } = selection;
  if ($from.parent.type.name !== 'tableCell' || !$from.sameParent($to)) return null;
  const pos = $from.before();
  return Decoration.node(pos, pos + $from.parent.nodeSize, { class: 'aee-cell-active' });
}

/** A node decoration marking the table whose *last column* and/or *last row*
    holds the caret — a cell counts when its span reaches that edge of the
    grid. The classes drive the add pills' focus reveal. */
function tableEdgeDecoration(state: EditorState): Decoration | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'tableCell') continue;
    const table = $from.node(depth - 2);
    const tablePos = $from.before(depth - 2);
    const map = TableMap.get(table);
    const cell = map.findCell($from.before(depth) - (tablePos + 1));
    const classes = [
      cell.right === map.width ? 'aee-table-wrap--in-last-column' : '',
      cell.bottom === map.height ? 'aee-table-wrap--in-last-row' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (!classes) return null;
    return Decoration.node(tablePos, tablePos + table.nodeSize, { class: classes });
  }
  return null;
}

/** A boundary is draggable only where some row actually has a cell edge on
    it — inside a cell that spans it there is nothing to move. */
function isDraggable(map: TableMap, boundary: number): boolean {
  for (let row = 0; row < map.height; row++) {
    const index = row * map.width + boundary;
    if (map.map[index] !== map.map[index + 1]) return true;
  }
  return false;
}

/**
 * The editor's rendering of a table: a scroll wrapper, a `<colgroup>`
 * mirroring the declared widths, and the full-height boundary lines. All of
 * it is editor furniture — the schema's `toDOM` (used for the email *and* the
 * clipboard) stays the bare table, so nothing here can leak into a
 * serialization.
 */
class TableView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  #box: HTMLElement;
  #table: HTMLTableElement;
  #colgroup: HTMLElement;
  #lines: HTMLElement;
  #boundaries: HTMLElement;
  #edges: { left: HTMLElement; right: HTMLElement };
  #addColumnZone: HTMLElement;
  #addColumn: HTMLElement;
  #addRowZone: HTMLElement;
  #addRow: HTMLElement;
  #node: Node;
  #view: EditorView;
  #getPos: () => number;

  constructor(node: Node, view: EditorView, getPos: () => number) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'aee-table-wrap';
    // The gutter belongs to the wrapper (editorial space); the box inside it
    // is the block's own area, and every piece of geometry measures against
    // that — so the gutter can change without moving a single number.
    this.#box = this.dom.appendChild(document.createElement('div'));
    this.#box.className = 'aee-table-box';
    this.#table = this.#box.appendChild(document.createElement('table'));
    this.#table.setAttribute(
      'style',
      tableStyle(
        node.attrs['width'] as number,
        node.attrs['offset'] as number,
        node.attrs['spacing'] as number | null,
      ),
    );
    this.#table.setAttribute('role', 'presentation');
    this.#colgroup = this.#table.appendChild(document.createElement('colgroup'));
    this.contentDOM = this.#table.appendChild(document.createElement('tbody'));
    this.#lines = this.#box.appendChild(document.createElement('div'));
    this.#lines.className = 'aee-col-lines';
    this.#lines.contentEditable = 'false';
    this.#lines.setAttribute('aria-hidden', 'true');
    // The boundary lines get their own container: the render pass trims it to
    // exactly one child per boundary, which would otherwise delete the edge
    // handles and the add zone that share this layer.
    this.#boundaries = this.#lines.appendChild(document.createElement('div'));
    this.#boundaries.className = 'aee-col-boundaries';
    // The table's own resize handles, one per outer edge. Wrapper-relative,
    // so their `left`s *are* the model's offset and offset + width — numbers
    // straight from the document, no measurement.
    const edge = (side: 'left' | 'right') => {
      // Inside the lines layer, which CSS insets to the wrapper's *content*
      // box — so every percentage below is a share of the table's own area,
      // gutter or no gutter.
      const el = this.#lines.appendChild(document.createElement('div'));
      // Its side, too: hovering the right one is on the way to the add
      // column pill, and reveals it (styles.scss).
      el.className = `aee-col-line aee-col-line--edge aee-col-line--edge-${side}`;
      el.contentEditable = 'false';
      el.setAttribute('aria-hidden', 'true');
      el.addEventListener('pointerdown', (event) => this.#startEdgeDrag(side, event));
      return el;
    };
    this.#edges = { left: edge('left'), right: edge('right') };
    // The `+` pills: one on the right flank (append a column), one under the
    // bottom edge (append a row). Notion's two bars: a click adds one, a drag
    // adds or takes away as many as it covers (`#startExtend`).
    const pill = (axis: Axis, label: string) => {
      const el = this.dom.appendChild(document.createElement('div'));
      el.className = `aee-add-pill aee-add-pill--${axis}`;
      el.textContent = '+';
      el.contentEditable = 'false';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('title', label);
      el.addEventListener('pointerdown', (event) => this.#startExtend(axis, event));
      return el;
    };
    this.#addColumn = pill('column', EXTEND_LABELS.column);
    // The sensor zone — one contiguous strip from the table's right edge out
    // to the pill (the YouTube-gesture-layer idea): hovering anywhere along
    // it reveals the pill, so the pointer never crosses dead space on its way
    // over. It covers only non-editable ground, which is why it can stay
    // hit-testable at all times; clicks on the zone itself do nothing — only
    // the pill acts.
    this.#addColumnZone = this.#lines.appendChild(document.createElement('div'));
    this.#addColumnZone.className = 'aee-add-zone aee-add-zone--column';
    this.#addColumnZone.contentEditable = 'false';
    this.#addColumnZone.setAttribute('aria-hidden', 'true');
    this.#addColumnZone.appendChild(this.#addColumn);
    // The row twin lives on the box, not the wrapper: its `left` / `width`
    // are then the same table-relative percentages the column zone and the
    // edge handles already speak, and a right-edge drag can restamp them
    // on release without measuring. It hangs into the wrapper's bottom
    // gutter (`top: 100%`), so approaching from below still wakes the
    // pill and nothing editable is covered.
    this.#addRowZone = this.#box.appendChild(document.createElement('div'));
    this.#addRowZone.className = 'aee-add-zone aee-add-zone--row';
    this.#addRowZone.contentEditable = 'false';
    this.#addRowZone.setAttribute('aria-hidden', 'true');
    this.#addRow = pill('row', EXTEND_LABELS.row);
    this.#addRowZone.appendChild(this.#addRow);
    // Column-grip hover is a data attribute on this wrap, not 24 `:has()`
    // rules walking the grid on every pointer move — same reveal, none of
    // the style-recalc tax those selectors levy on a hovered table.
    this.dom.addEventListener('pointerover', (event) => this.#hoverColumn(event));
    this.dom.addEventListener('pointerleave', () => this.#clearHoverColumn());
    this.#render(node);
    this.#markKind(node);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'table') return false;
    // Typing in a cell produces a new table node. The chrome (widths, lines,
    // edges) has not moved, and rewriting it every keystroke is what makes a
    // table feel like it is flying apart — Tiptap's TableView skips this
    // path for the same reason. Persistent node identity makes the compare
    // a handful of pointer checks on the rows that did not change.
    if (!sameTableChrome(this.#node, node) || node.attrs['html'] !== this.#node.attrs['html']) {
      this.#render(node);
    }
    this.#markKind(node);
    this.#node = node;
    return true;
  }

  /** A layout table says so on its wrap — the hook the stylesheet hides a
      static one's lines and pills by (`setLayoutInteraction`). Every
      update, not only on a chrome change: a cell's line makes the kind. */
  #markKind(node: Node): void {
    this.dom.classList.toggle('aee-table-wrap--layout', tableKind(node) === 'layout');
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    // The wrapper, the table element, the colgroup and the lines layer are
    // ours; ProseMirror owns only what happens inside the tbody.
    const target = record.target;
    return (
      target !== this.contentDOM && !this.contentDOM.contains(target) && this.dom.contains(target)
    );
  }

  #hoverColumn(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // A row grip lives inside that row's first cell. Reading `data-col`
    // off that cell would light column 0's grip for a pointer that is
    // only asking for the row. Clear instead, so only the row handle
    // shows; a later cell hover writes the column back.
    if (target.closest('.aee-grip--row')) {
      this.#clearHoverColumn();
      return;
    }
    const col = target.closest('td')?.getAttribute('data-col') ?? '';
    if (this.dom.dataset['hoverCol'] === col) return;
    if (col) this.dom.dataset['hoverCol'] = col;
    else delete this.dom.dataset['hoverCol'];
  }

  #clearHoverColumn(): void {
    delete this.dom.dataset['hoverCol'];
  }

  #render(node: Node): void {
    const declared = columnWidths(node);
    const effective = effectiveWidths(node);
    const map = TableMap.get(node);
    const tableWidth = node.attrs['width'] as number;
    const offset = node.attrs['offset'] as number;

    // The table's box and everything positioned against it. The lines layer
    // is CSS-inset to the wrapper's content box (inside the editor-only
    // gutter), so a child's `left` percentage is a share of the table's own
    // area — table-relative shares are converted once, here.
    this.#table.setAttribute(
      'style',
      tableStyle(tableWidth, offset, node.attrs['spacing'] as number | null),
    );
    // An authored table (a template's, parsed in the `email` mode) shows its
    // own attributes, as the email does — see authored.ts.
    applyAuthoredAttributes(this.#table, node, 0);
    applyAuthoredAttributes(this.contentDOM, node, 1);
    // The hook for drawing it without the composer's table chrome.
    this.dom.classList.toggle('aee-table-wrap--authored', !!node.attrs['html']);
    this.#edges.left.style.left = `${offset}%`;
    this.#edges.right.style.left = `${offset + tableWidth}%`;
    // At the container's own edges the *grab strip* tucks fully inside — a
    // 9px strip hanging half out is phantom overflow (a scrollbar with
    // nothing visibly overflowing), and it would reach into the flank where
    // the row affordances live. Anywhere else the strip straddles its edge.
    // The class says which, because the line drawn inside the strip has to
    // know: a tucked strip's line sits at the tucked side, on the table's
    // edge, not in the middle of the strip 4.5px inside it (styles.scss).
    this.#edges.left.classList.toggle('aee-col-line--tuck-start', offset === 0);
    this.#edges.right.classList.toggle('aee-col-line--tuck-end', offset + tableWidth >= 100);
    this.#placeAddOns(offset, tableWidth);
    // The room below that is the table's own — a bordered or borderless
    // table's real `margin-bottom` (`spacing`): no text stands there, so the
    // row sensor may take the pointer at all times and is exactly that high
    // (styles.scss). A layout table has none, and the text below wins.
    const room = node.attrs['spacing'] as number | null;
    this.#addRowZone.toggleAttribute('data-room', !!room);
    if (room) this.#addRowZone.style.setProperty('--aee-table-room', `${room}px`);
    else this.#addRowZone.style.removeProperty('--aee-table-room');

    // The display colgroup: declared widths verbatim, the rest left to the
    // browser — the same input the email gives a mail client.
    resizeChildren(this.#colgroup, declared.length, 'col');
    declared.forEach((width, index) => {
      const col = this.#colgroup.children[index] as HTMLElement;
      if (width != null) col.style.width = formatPct(width);
      else col.style.removeProperty('width');
    });

    // One line per interior boundary, placed at the cumulative share — the
    // document says where the boundary is, so no measurement, ever. Elements
    // are reused so a mid-drag re-render can't orphan the drag.
    resizeChildren(this.#boundaries, Math.max(declared.length - 1, 0), 'div', (line) => {
      line.className = 'aee-col-line';
      line.addEventListener('pointerdown', (event) => this.#startDrag(line, event));
    });
    let cumulative = 0;
    for (let boundary = 0; boundary < declared.length - 1; boundary++) {
      cumulative += effective[boundary];
      const line = this.#boundaries.children[boundary] as HTMLElement;
      line.style.left = `${this.#toBoxPct(cumulative)}%`;
      line.style.display = isDraggable(map, boundary) ? '' : 'none';
    }
  }

  /** The add-on zones: column strip starts on the table's right edge, row
      strip is the table's own width under it. Model percentages, same
      language as the edge handles — a right-edge drag restamps both. */
  #placeAddOns(offset: number, width: number): void {
    this.#addColumnZone.style.left = `${offset + width}%`;
    this.#addRowZone.style.left = `${offset}%`;
    this.#addRowZone.style.width = `${width}%`;
  }

  /** A share of the *table* (what the model speaks) as a share of the
      wrapper's content box (what the lines layer measures against). */
  #toBoxPct(tablePct: number): number {
    const width = this.#node.attrs['width'] as number;
    const offset = this.#node.attrs['offset'] as number;
    return offset + (tablePct * width) / 100;
  }

  /** The block's own area — the box inside the editorial gutter, which is
      what every percentage here is a share of. */
  #contentBox(): { left: number; width: number } {
    const rect = this.#box.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  }

  /** Whether this table takes its drags and pills (`setLayoutInteraction`):
      a bordered or borderless one always does. */
  #interactive(): boolean {
    return layoutBlockInteractive(this.#view.state, this.#node);
  }

  #startDrag(line: HTMLElement, event: PointerEvent): void {
    // Keeps the caret where it is and stops ProseMirror starting a selection.
    event.preventDefault();
    if (!this.#interactive()) return;
    const boundary = Array.prototype.indexOf.call(this.#boundaries.children, line);
    const tableWidth = this.#table.getBoundingClientRect().width;
    if (boundary < 0 || !tableWidth) return;

    const effective = effectiveWidths(this.#node);
    const pair = effective[boundary] + effective[boundary + 1];
    if (pair < MIN_COLUMN_PCT * 2) return;
    const startX = event.clientX;
    const startLeft = effective.slice(0, boundary + 1).reduce((sum, width) => sum + width, 0);

    const leftAt = (ev: PointerEvent) =>
      clamp(
        effective[boundary] + ((ev.clientX - startX) / tableWidth) * 100,
        MIN_COLUMN_PCT,
        pair - MIN_COLUMN_PCT,
      );

    // Deferred commit: mid-drag ONLY the guide line moves, at full float
    // precision. The table itself must not reflow per pointermove — its text
    // rewrapping every frame reads as the grid flying apart (tried, reverted).
    // A bonus of the still table: `tableWidth`, measured once above, stays
    // exact for the whole drag.
    const preview = (ev: PointerEvent) => {
      line.style.left = `${this.#toBoxPct(startLeft - effective[boundary] + leftAt(ev))}%`;
    };
    const finish = (ev: PointerEvent) => {
      releaseCursor();
      setColumnBoundary(
        this.#getPos(),
        boundary,
        leftAt(ev),
      )(this.#view.state, this.#view.dispatch);
      // Chrome stays hidden until the commit has restamped it — otherwise
      // the pills flash one frame at the pre-drag box.
      line.classList.remove('aee-col-line--drag');
      this.dom.classList.remove('aee-table-wrap--resizing');
    };

    line.classList.add('aee-col-line--drag');
    // Pin the grid for the drag's lifetime. The guides are hover-revealed, and
    // mid-drag the pointer wanders off the wrapper — without this the walls
    // fade in and out under the moving line, which reads as dragging one
    // object while a different one trails behind.
    this.dom.classList.add('aee-table-wrap--resizing');
    // Same reasoning for the cursor: off the 9px strip it would flip back to
    // a text caret mid-drag. It stays col-resize until release.
    const releaseCursor = holdDragCursor('col-resize');
    // Window-level, animation-frame coalesced: the pointer can move faster
    // than a frame (and faster than layout follows), and a handle-bound
    // listener would lose the stream and stutter. `window` never loses it;
    // rAF writes the line at most once per frame, the way Notion and Tiptap
    // keep a drag on the compositor.
    trackPointer(preview, finish);
  }

  /**
   * A press on a `+` pill: Notion's two bars, fitted to an email's fixed
   * width. Released in place it adds one column (or row) — the click, one
   * step of the drag below.
   *
   * Dragged, it counts Notion's way (measured off Notion's own): the
   * count is how far the pointer has gone from the press, in fixed steps,
   * either way, after a quarter step of slack — never the bands' own sizes,
   * so the whole table is a few steps from its last column, wherever the
   * hand is. A column's step is half a default column (a sixth of the
   * room); a row's, the last row's height. Every column keeps its own size
   * on the page, so the table's edge — and its pill — moves with the
   * count: taking one away shrinks the table by it, and a new one, a step
   * wide, grows it until it fills its room; past that the columns share
   * it, none below `MIN_COLUMN_PCT`, so at most ten (an email has no
   * sideways scroll to spill into). At either limit — the cap, the last
   * band that can go — the travel beyond it is dropped, so the way back
   * starts at once.
   *
   * Only empty bands go (`removeEmptyLastColumn`): a drag loses no words.
   * Past the first one of an empty table, the table itself is on its way
   * out — faded, the badge at 0 — and released there, it is taken away.
   *
   * What each count shows is Notion's too (recorded off Notion's own): a
   * step in takes the last band away, a step out adds a fresh one — a
   * column half a default one wide — and back at the count it began with,
   * the table is the very one the press found. So past 0 and out again,
   * the first steps are fresh minis, and at the start they turn back into
   * the columns that were there; let go on a mini, and the next drag
   * starts from it.
   *
   * The table follows the pointer live, outside the undo history; release
   * lands the change as one step. A badge by the pointer says what it will
   * be (`TABLE_EXTEND_BADGE_CLASS`, columns × rows). Escape puts the table
   * back as it was.
   */
  #startExtend(axis: Axis, event: PointerEvent): void {
    // Keeps the caret where it is, and the press off ProseMirror.
    event.preventDefault();
    if (event.button !== 0 || !this.#interactive()) return;
    const view = this.#view;
    const pos = this.#getPos();
    const start = view.state;
    const table = start.doc.nodeAt(pos);
    if (!table) return;
    const map = TableMap.get(table);
    const column = axis === 'column';
    const room = this.#contentBox().width;

    // Each column's size on the page as the press found it (percent of the
    // room), and the step a band is worth.
    const offset = table.attrs['offset'] as number;
    const tableWidth = table.attrs['width'] as number;
    const columnPcts = effectiveWidths(table).map((share) => (share * tableWidth) / 100);
    const lastRow = this.contentDOM.lastElementChild;
    // Nothing laid out (no step): the click still works, the drag does not.
    const step = column
      ? (room * EXTEND_COLUMN_PCT) / 100
      : (lastRow?.getBoundingClientRect().height ?? 0);
    const bands = column ? map.width : map.height;
    const most = Math.max(
      0,
      column ? Math.floor(100 / MIN_COLUMN_PCT) - map.width : EXTEND_MAX_ROWS - map.height,
    );
    const emptyTable = isTableEmpty(table);
    let origin = column ? event.clientX : event.clientY;
    const add = column ? addColumnAtEnd : addRowAtEnd;
    const remove = column ? removeEmptyLastColumn : removeEmptyLastRow;

    /** The table as the press found it with only its first `keep` bands,
        and `fresh` new ones after them — and how many it kept: a band
        with words in it stays. Keeping none, the one band left of an empty
        table stands in for a fresh one. Columns keep their own sizes on
        the page, a fresh one a mini (`holdColumnSizes`). */
    const build = (keep: number, fresh: number): { node: Node; kept: number } => {
      let state = start;
      let left = bands;
      while (left > Math.max(keep, 1) && remove(pos)(state, (tr) => (state = state.apply(tr)))) {
        left--;
      }
      const kept = keep === 0 && left === 1 && emptyTable ? 0 : left;
      for (let i = kept ? 0 : 1; i < fresh; i++) add(pos)(state, (tr) => (state = state.apply(tr)));
      if (column && (kept < bands || fresh)) {
        state = holdColumnSizes(state, pos, columnPcts.slice(0, kept), offset);
      }
      return { node: state.doc.nodeAt(pos)!, kept };
    };
    /** Where `total` bands come from, Notion's way: the start is the table
        the press found; out, fresh bands after what stands; in, the last
        one goes — fresh ones first. Crossing the start on the way out, the
        press's own bands are back before any fresh one. */
    const steer = (total: number): [number, number] => {
      if (total === bands) return [bands, 0];
      if (total > kept + fresh) {
        return kept + fresh < bands && total > bands
          ? [bands, total - bands]
          : [kept, fresh + total - (kept + fresh)];
      }
      const drop = kept + fresh - total;
      const fromFresh = Math.min(drop, fresh);
      return [kept - (drop - fromFresh), fresh - fromFresh];
    };
    /** Puts `next` where the table is now; in the undo history or not. */
    const show = (next: Node, history: boolean) => {
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type !== next.type || current === next) return;
      const tr = view.state.tr.replaceWith(pos, pos + current.nodeSize, next);
      // Its own step, never folded into the typing just before it.
      if (history) closeHistory(tr);
      else tr.setMeta('addToHistory', false);
      view.dispatch(tr);
    };

    // What stands: the press's own bands still there, and fresh ones after.
    let kept = bands;
    let fresh = 0;
    let gone = false;
    let dragging = false;
    let cancelled = false;
    let badge: HTMLElement | null = null;
    /** The badge by the pointer: what the table is now, columns × rows. */
    const tell = (shown: Node, at: PointerEvent) => {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = TABLE_EXTEND_BADGE_CLASS;
        badge.setAttribute('aria-hidden', 'true');
        // The editor's scheme, wherever it is drawn (the marquee's way).
        badge.style.colorScheme = getComputedStyle(view.dom).colorScheme;
        // In an open modal dialog's top layer, or the page's.
        (this.dom.closest('dialog[open]') ?? document.body).appendChild(badge);
      }
      const size = TableMap.get(shown);
      const width = gone && column ? 0 : size.width;
      const height = gone && !column ? 0 : size.height;
      badge.textContent = `${width} × ${height}`;
      badge.style.left = `${at.clientX + 12}px`;
      badge.style.top = `${at.clientY + 16}px`;
    };
    /** At 0 the table is gone from under the pill, which stands at its
        start — the left edge (the top, for rows) — as Notion's does; back
        from 0, at the edge the table has again. */
    const fade = (on: boolean) => {
      gone = on;
      this.dom.classList.toggle('aee-table-wrap--going', on);
      const node = this.#node;
      if (column) {
        if (on) this.#addColumnZone.style.left = `${node.attrs['offset']}%`;
        else this.#placeAddOns(node.attrs['offset'] as number, node.attrs['width'] as number);
      } else {
        this.#addRowZone.style.top = on ? '0' : '';
      }
    };
    let releaseCursor: (() => void) | null = null;
    const end = () => {
      releaseCursor?.();
      releaseCursor = null;
      this.dom.classList.remove(`aee-table-wrap--extending-${axis}`);
      badge?.remove();
      badge = null;
      window.removeEventListener('keydown', key, true);
    };
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== 'Escape' || !dragging) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      cancelled = true;
      fade(false);
      show(table, false);
      end();
    };
    const preview = (moved: PointerEvent) => {
      // An editor gone mid-drag (its composer closed) takes nothing more.
      if (cancelled || !step || view.isDestroyed) return;
      const at = column ? moved.clientX : moved.clientY;
      const delta = at - origin;
      if (!dragging) {
        if (Math.abs(delta) < EXTEND_THRESHOLD) return;
        dragging = true;
        // The pill, the grid and the cursor stay through the drag, wherever
        // the pointer goes.
        this.dom.classList.add(`aee-table-wrap--extending-${axis}`);
        releaseCursor = holdDragCursor(column ? 'col-resize' : 'row-resize');
      }
      // A quarter step of slack, then one band a step, either way.
      const reach = Math.abs(delta) - step / 4;
      const wanted = reach > 0 ? Math.sign(delta) * Math.ceil(reach / step) : 0;
      // Past its last band, an empty table is on its way out.
      const total = clamp(bands + wanted, emptyTable ? 0 : 1, bands + most);
      const [keep, more] = steer(total);
      if (keep !== kept || more !== fresh) {
        const result = build(keep, more);
        kept = result.kept;
        fresh = more;
        show(result.node, false);
      }
      const reached = kept + fresh - bands;
      if ((kept + fresh === 0) !== gone) fade(kept + fresh === 0);
      // Past a limit — the cap, the last band that can go — the travel
      // beyond it is dropped: the pointer stands at the far end of the
      // count it has, and one step back changes the table again.
      if (wanted !== reached) {
        origin = at - Math.sign(wanted) * (Math.abs(reached) * step + step / 4);
      }
      tell(view.state.doc.nodeAt(pos) ?? table, moved);
    };
    const finish = () => {
      if (cancelled) return;
      end();
      if (view.isDestroyed) return;
      if (!dragging) {
        if (most) show(build(bands, 1).node, true);
        return;
      }
      if (gone) {
        // Released past the last band: the table goes, as one step.
        fade(false);
        show(table, false);
        const tr = view.state.tr.delete(pos, pos + table.nodeSize);
        view.dispatch(closeHistory(tr).scrollIntoView());
        return;
      }
      if (kept === bands && !fresh) return;
      // One step for the whole drag: back to the table the press found,
      // outside the history, then the result, in it.
      const result = view.state.doc.nodeAt(pos);
      if (!result) return;
      show(table, false);
      show(result, true);
    };
    window.addEventListener('keydown', key, true);
    trackPointer(preview, finish);
  }

  /** The table's own resize: drag either outer edge, same deferred-commit
      and pinning discipline as a boundary drag — only the edge line moves,
      and release applies one transaction. The left edge moves the offset
      (the right edge stays put); the right edge moves the width. */
  #startEdgeDrag(side: 'left' | 'right', event: PointerEvent): void {
    event.preventDefault();
    if (!this.#interactive()) return;
    const { left: wrapperLeft, width: wrapperWidth } = this.#contentBox();
    if (!wrapperWidth) return;

    const handle = this.#edges[side];
    const offset = this.#node.attrs['offset'] as number;
    const oldWidth = this.#node.attrs['width'] as number;
    const right = offset + oldWidth;

    // The drag can't shrink the table past the point where the absorbing
    // column (the one beside the dragged edge) hits the column floor — the
    // same bound the commit enforces, so the preview line never over-promises.
    const map = TableMap.get(this.#node);
    const effective = effectiveWidths(this.#node);
    const others = map.width > 1 ? 100 - effective[side === 'left' ? 0 : map.width - 1] : 0;
    const minWidth = minTableWidth(oldWidth, others);

    const pctAt = (ev: PointerEvent) => ((ev.clientX - wrapperLeft) / wrapperWidth) * 100;
    const edgeAt = (ev: PointerEvent) =>
      side === 'left'
        ? clamp(pctAt(ev), 0, right - minWidth)
        : clamp(pctAt(ev), offset + minWidth, 100);

    const preview = (ev: PointerEvent) => {
      const edge = edgeAt(ev);
      handle.style.left = `${edge}%`;
      // The column `+` rides the moving edge so it is already at the new
      // flank when the drag ends. The row `+` waits for release: resizing
      // it every frame would be a live reflow of a strip we then hide.
      if (side === 'right') this.#addColumnZone.style.left = `${edge}%`;
    };
    const finish = (ev: PointerEvent) => {
      releaseCursor();
      const edge = edgeAt(ev);
      const box: [number, number] =
        side === 'left' ? [edge, right - edge] : [offset, edge - offset];
      setTableBox(
        this.#getPos(),
        ...box,
        side === 'left' ? 'first' : 'last',
      )(this.#view.state, this.#view.dispatch);
      // Commit restamps the handles *and* both add-ons onto the model.
      // The row `+` picks up the new width here, once, on release. If the
      // commit was a no-op (clamped to the same values), this snaps the
      // previewed column zone back too.
      this.#render(this.#node);
      handle.classList.remove('aee-col-line--drag');
      this.dom.classList.remove('aee-table-wrap--resizing');
    };

    handle.classList.add('aee-col-line--drag');
    this.dom.classList.add('aee-table-wrap--resizing');
    const releaseCursor = holdDragCursor('col-resize');
    trackPointer(preview, finish);
  }
}

/** Whether the table chrome (box, column widths, grid) is the same — the
    question `TableView.update` asks before it touches the DOM. Unchanged
    rows are the same object (ProseMirror's persistent tree), so a keystroke
    is one new cell and a handful of identity compares. */
function sameTableChrome(a: Node, b: Node): boolean {
  if (
    a.attrs['width'] !== b.attrs['width'] ||
    a.attrs['offset'] !== b.attrs['offset'] ||
    a.attrs['spacing'] !== b.attrs['spacing']
  ) {
    return false;
  }
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
      if (
        !sameWidthList(
          from.attrs['colwidth'] as number[] | null,
          to.attrs['colwidth'] as number[] | null,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function sameWidthList(a: number[] | null, b: number[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Window-level pointer tracking for the life of a drag: move is coalesced
    to animation frames so a 120 Hz stream cannot write the line more than
    once per paint; up/cancel apply the last event immediately. */
/** The class of the badge a `+` pill's drag shows by the pointer — the
    table's columns × rows as the drag has it. The host paints it. */
export const TABLE_EXTEND_BADGE_CLASS = 'aee-table-extend-badge';

/** Which way a `+` pill extends the table. */
type Axis = 'column' | 'row';

/** What each pill says it does, Notion's words. */
const EXTEND_LABELS: Record<Axis, string> = {
  column: 'Click to add a column\nDrag to add or remove columns',
  row: 'Click to add a row\nDrag to add or remove rows',
};

/** A new column's size when a pill's drag adds one: half a default
    column, in percent of the table's room. */
const EXTEND_COLUMN_PCT = 100 / (TABLE_COLUMNS * 2);

/**
 * Lays a table's columns out at the sizes they had on the page — `sizes`,
 * in percent of the room, one per column the drag's press found; a column
 * past those is a new one, {@link EXTEND_COLUMN_PCT} wide. The table grows
 * or shrinks to hold them, within its room and above `MIN_TABLE_PCT`;
 * where they do not fit, they share the room in proportion, none below
 * `MIN_COLUMN_PCT`. Every cell then declares its share.
 */
function holdColumnSizes(
  state: EditorState,
  pos: number,
  sizes: number[],
  offset: number,
): EditorState {
  const table = state.doc.nodeAt(pos);
  if (!table) return state;
  const map = TableMap.get(table);
  const wanted = Array.from({ length: map.width }, (_, col) => sizes[col] ?? EXTEND_COLUMN_PCT);
  const total = wanted.reduce((sum, size) => sum + size, 0);
  const width = round1(clamp(total, MIN_TABLE_PCT, 100 - offset));
  const shares = floorShares(wanted.map((size) => (size / total) * 100)).map(round1);
  const tr = state.tr;
  const seen = new Set<number>();
  for (const rel of map.map) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const cell = table.nodeAt(rel)!;
    const left = map.findCell(rel).left;
    const colwidth = shares.slice(left, left + (cell.attrs['colspan'] as number));
    tr.setNodeMarkup(pos + 1 + rel, null, { ...cell.attrs, colwidth });
  }
  tr.setNodeMarkup(pos, null, { ...table.attrs, width });
  return state.apply(tr);
}

/** Shares summing to 100, none below `MIN_COLUMN_PCT`: those below are
    raised to it, and the rest give up the difference in proportion. */
function floorShares(shares: number[]): number[] {
  const pinned = shares.map(() => false);
  let out = shares;
  for (let pass = 0; pass < shares.length; pass++) {
    const low = out.map((share, i) => !pinned[i] && share < MIN_COLUMN_PCT);
    if (!low.includes(true)) break;
    low.forEach((isLow, i) => {
      if (isLow) pinned[i] = true;
    });
    const free = 100 - pinned.filter(Boolean).length * MIN_COLUMN_PCT;
    const freeSum = out.reduce((sum, share, i) => (pinned[i] ? sum : sum + share), 0) || 1;
    out = out.map((share, i) => (pinned[i] ? MIN_COLUMN_PCT : (share / freeSum) * free));
  }
  return out;
}

/** How far, in px, a press on a pill moves before it is a drag. */
const EXTEND_THRESHOLD = 4;

/** As far as a row pill's drag goes: no email table wants more rows. (A
    column pill's stops where a column would go below `MIN_COLUMN_PCT`.) */
const EXTEND_MAX_ROWS = 100;

function trackPointer(
  preview: (event: PointerEvent) => void,
  finish: (event: PointerEvent) => void,
): void {
  let frame = 0;
  let last: PointerEvent | null = null;
  const onMove = (event: PointerEvent) => {
    last = event;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (last) preview(last);
    });
  };
  const onUp = (event: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (frame) cancelAnimationFrame(frame);
    finish(event);
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** Grows or shrinks `parent` to exactly `count` children of `tag`, reusing
    the ones that exist. `init` runs once per newly created element. */
function resizeChildren(
  parent: HTMLElement,
  count: number,
  tag: string,
  init?: (el: HTMLElement) => void,
): void {
  while (parent.children.length > count) parent.lastElementChild!.remove();
  while (parent.children.length < count) {
    const el = parent.appendChild(document.createElement(tag));
    init?.(el);
  }
}
