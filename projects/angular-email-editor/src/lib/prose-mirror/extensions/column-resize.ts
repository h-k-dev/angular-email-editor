import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView, ViewMutationRecord } from 'prosemirror-view';
import { CellSelection, TableMap } from 'prosemirror-tables';
import { defineExtension } from '../extension';
import {
  MIN_COLUMN_PCT,
  MIN_TABLE_PCT,
  addColumnAtEnd,
  addRowAtEnd,
  formatPct,
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
export const ColumnResize = defineExtension({
  name: 'columnResize',
  plugins: () => [
    new Plugin({
      key: new PluginKey('columnResize'),
      props: {
        nodeViews: {
          table: (node, view, getPos) => new TableView(node, view, getPos as () => number),
        },
        // The add pills reveal when the caret stands in the last column /
        // last row; the classes land on the table's NodeView wrapper. The
        // hover half of each reveal is pure CSS (`:has(td:last-child:hover)`,
        // `:has(tr:last-child:hover)`) — this is only the focus half, derived
        // from the selection like everything else.
        decorations: (state) => {
          const decorations = selectionEdgeDecorations(state);
          const marked = tableEdgeDecoration(state);
          if (marked) decorations.push(marked);
          return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
        },
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
        width = round1(
          clamp(width, minTableWidth(oldWidth, others), 100 - offset),
        );
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
      tableStyle(node.attrs['width'] as number, node.attrs['offset'] as number),
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
      el.className = 'aee-col-line aee-col-line--edge';
      el.contentEditable = 'false';
      el.setAttribute('aria-hidden', 'true');
      el.addEventListener('pointerdown', (event) => this.#startEdgeDrag(side, event));
      return el;
    };
    this.#edges = { left: edge('left'), right: edge('right') };
    // The `+` pills: one on the right flank (append a column), one under the
    // bottom edge (append a row). Compact, not Tiptap's full-length strips,
    // so the edge-drag handle keeps the rest of the edge to itself.
    const pill = (className: string, label: string, command: (pos: number) => Command) => {
      const el = this.dom.appendChild(document.createElement('div'));
      el.className = `aee-add-pill ${className}`;
      el.textContent = '+';
      el.contentEditable = 'false';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('title', label);
      // preventDefault keeps the caret where it is; the command runs on click.
      el.addEventListener('mousedown', (event) => event.preventDefault());
      el.addEventListener('click', () => {
        command(this.#getPos())(this.#view.state, this.#view.dispatch);
      });
      return el;
    };
    this.#addColumn = pill('aee-add-pill--column', 'Add column', addColumnAtEnd);
    // The sensor zone — one contiguous strip from the table's right edge out
    // to the pill (the YouTube-gesture-layer idea): hovering anywhere along
    // it reveals the pill, so the pointer never crosses dead space on its way
    // over. It covers only non-editable ground, which is why it can stay
    // hit-testable at all times; clicks on the zone itself do nothing — only
    // the pill acts.
    this.#addColumnZone = this.#lines.appendChild(document.createElement('div'));
    this.#addColumnZone.className = 'aee-add-zone';
    this.#addColumnZone.contentEditable = 'false';
    this.#addColumnZone.setAttribute('aria-hidden', 'true');
    this.#addColumnZone.appendChild(this.#addColumn);
    this.#addRow = pill('aee-add-pill--row', 'Add row', addRowAtEnd);
    this.#render(node);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'table') return false;
    this.#node = node;
    this.#render(node);
    return true;
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    // The wrapper, the table element, the colgroup and the lines layer are
    // ours; ProseMirror owns only what happens inside the tbody.
    const target = record.target;
    return (
      target === this.dom ||
      target === this.#box ||
      target === this.#table ||
      target === this.#colgroup ||
      this.#colgroup.contains(target) ||
      this.#lines.contains(target) ||
      target === this.#lines ||
      target === this.#edges.left ||
      target === this.#edges.right ||
      target === this.#addColumnZone ||
      this.#addColumnZone.contains(target) ||
      target === this.#addRow ||
      this.#addRow.contains(target)
    );
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
    this.#table.setAttribute('style', tableStyle(tableWidth, offset));
    this.#edges.left.style.left = `${offset}%`;
    this.#edges.right.style.left = `${offset + tableWidth}%`;
    // At the container's own edges the handles tuck fully inside — a strip
    // hanging half out of the wrapper is phantom overflow (a scrollbar with
    // nothing visibly overflowing). Anywhere else they straddle their edge.
    this.#edges.left.style.transform = offset === 0 ? 'translateX(0)' : 'translateX(-50%)';
    this.#edges.right.style.transform =
      offset + tableWidth >= 100 ? 'translateX(-100%)' : 'translateX(-50%)';
    // The sensor zone starts exactly at the table's right edge (its far end,
    // holding the pill, is pinned to the gutter in CSS). The row pill needs
    // no positioning at all: it is latched full-width to the wrapper.
    this.#addColumnZone.style.left = `${offset + tableWidth}%`;

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

  #startDrag(line: HTMLElement, event: PointerEvent): void {
    // Keeps the caret where it is and stops ProseMirror starting a selection.
    event.preventDefault();
    const boundary = Array.prototype.indexOf.call(this.#boundaries.children, line);
    const tableWidth = this.#table.getBoundingClientRect().width;
    if (boundary < 0 || !tableWidth) return;

    const effective = effectiveWidths(this.#node);
    const pair = effective[boundary] + effective[boundary + 1];
    if (pair < MIN_COLUMN_PCT * 2) return;
    const startX = event.clientX;
    const startLeft = effective
      .slice(0, boundary + 1)
      .reduce((sum, width) => sum + width, 0);

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
      window.removeEventListener('pointermove', preview);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      line.classList.remove('aee-col-line--drag');
      this.dom.classList.remove('aee-table-wrap--resizing');
      document.body.style.cursor = bodyCursor;
      setColumnBoundary(this.#getPos(), boundary, leftAt(ev))(
        this.#view.state,
        this.#view.dispatch,
      );
    };

    line.classList.add('aee-col-line--drag');
    // Pin the grid for the drag's lifetime. The guides are hover-revealed, and
    // mid-drag the pointer wanders off the wrapper — without this the walls
    // fade in and out under the moving line, which reads as dragging one
    // object while a different one trails behind.
    this.dom.classList.add('aee-table-wrap--resizing');
    // Same reasoning for the cursor: off the 9px strip it would flip back to
    // a text caret mid-drag. It stays col-resize until release.
    const bodyCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    // Window-level listeners for the drag's lifetime: the pointer can move
    // faster than layout follows, and a handle-bound listener would lose the
    // stream and stutter. `window` never loses it.
    window.addEventListener('pointermove', preview);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  /** The table's own resize: drag either outer edge, same deferred-commit
      and pinning discipline as a boundary drag — only the edge line moves,
      and release applies one transaction. The left edge moves the offset
      (the right edge stays put); the right edge moves the width. */
  #startEdgeDrag(side: 'left' | 'right', event: PointerEvent): void {
    event.preventDefault();
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
      handle.style.left = `${edgeAt(ev)}%`;
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', preview);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      handle.classList.remove('aee-col-line--drag');
      this.dom.classList.remove('aee-table-wrap--resizing');
      document.body.style.cursor = bodyCursor;
      const edge = edgeAt(ev);
      const box: [number, number] =
        side === 'left' ? [edge, right - edge] : [offset, edge - offset];
      setTableBox(this.#getPos(), ...box, side === 'left' ? 'first' : 'last')(
        this.#view.state,
        this.#view.dispatch,
      );
      // Commit re-renders the handles onto the model; if it was a no-op
      // (clamped to the same values), snap this one back explicitly.
      this.#render(this.#node);
    };

    handle.classList.add('aee-col-line--drag');
    this.dom.classList.add('aee-table-wrap--resizing');
    const bodyCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', preview);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }
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
