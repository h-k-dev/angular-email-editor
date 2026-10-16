import { applyAuthoredAttributes } from '../authored';
import { Command, Plugin, PluginKey } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { EditorView, ViewMutationRecord } from 'prosemirror-view';
import { defineExtension } from '../extension';
import {
  MAX_COLUMNS,
  MIN_COLUMN_CAP,
  appendColumn,
  columnCaps,
  containerStyle,
  removeLastColumn,
  setColumnsBoundary,
} from './nodes/columns';

/**
 * Boundary drag for the `/columns` layout block — the table drag's twin, with
 * the layout model underneath (see ROADMAP, "Columns and tables — decided").
 *
 * Same vocabulary: full-height primary lines on every boundary, hover to
 * reveal, deferred commit (only the line moves, one transaction on release,
 * one undo step), window-level listeners so the pointer can't outrun the
 * handle, guides pinned for the drag's lifetime.
 *
 * Different model: a table splits 100% of itself; columns redistribute the
 * email's px *budget* — the `max-width` caps that make the block fluid
 * (side by side where the caps fit, stacked on a phone). The drag moves px
 * between two neighbouring caps and conserves their sum, so the block's
 * stacking behaviour never changes, only the split.
 *
 * Geometry, as always, from the model: the NodeView's *box* carries the
 * container style (the email's centred 600px box), so a boundary's `left` is
 * simply the sum of the caps before it, in px. And "stacked" — the one state
 * where a horizontal drag means nothing — is a CSS container query on that
 * same box: the caps sum to a constant budget, so the block stacks at a
 * constant width, and the lines hide themselves. No measurement, no
 * observer.
 */
export const ColumnsResize = defineExtension({
  name: 'columnsResize',
  plugins: () => [
    new Plugin({
      key: new PluginKey('columnsResize'),
      props: {
        nodeViews: {
          columns: (node, view, getPos) => new ColumnsView(node, view, getPos as () => number),
        },
      },
    }),
  ],
});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * `div.aee-columns-wrap (editorial gutter) > div.aee-columns-box (the email's
 * container style) > div.aee-columns (contentDOM) + div.aee-col-lines`.
 *
 * The split matters: the gutter is editor-only room for the block's
 * affordances, while the box is the email's 600px centred container. Putting
 * both on one element would let editorial padding shrink the width the
 * columns lay out in — and since they stack at a constant budget, the editor
 * would start stacking at a pane width where the recipient still sees them
 * side by side. Separated, the gutter costs the layout nothing. The lines
 * layer sits inside the box, so its coordinates are the columns' own. The
 * schema's `toDOM` (clipboard) and `emitDOM` (email) are untouched.
 */
class ColumnsView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  #box: HTMLElement;
  #lines: HTMLElement;
  #append: HTMLElement;
  #remove: HTMLElement;
  #node: Node;
  #view: EditorView;
  #getPos: () => number;

  constructor(node: Node, view: EditorView, getPos: () => number) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    this.dom = document.createElement('div');
    this.dom.className = 'aee-columns-wrap';
    // Two roles, two elements — the reason this block needed restructuring.
    // The wrapper carries the *editorial* gutter (affordance room, no effect
    // on the email); the box inside it carries the *email's* container style,
    // so padding can never narrow the 600px the columns actually lay out in.
    this.#box = this.dom.appendChild(document.createElement('div'));
    this.#box.className = 'aee-columns-box';
    this.contentDOM = this.#box.appendChild(document.createElement('div'));
    this.contentDOM.className = 'aee-columns';
    this.contentDOM.setAttribute('style', 'width: 100%;');
    this.#lines = this.#box.appendChild(document.createElement('div'));
    this.#lines.className = 'aee-col-lines';
    this.#lines.contentEditable = 'false';
    this.#lines.setAttribute('aria-hidden', 'true');
    // The block's two pills, the table's `+` turned into a stepper: `+` on
    // the right flank appends a column, `−` on the left takes the last one
    // away. Each sits in a sensor zone over the gutter beside the box — only
    // non-editable ground, so the zone can stay hit-testable and the pointer
    // never crosses dead space on its way over. No delete button: the block
    // goes the table's way, selected whole and Delete.
    this.#append = this.#pill('end', '+', 'Add column', appendColumn);
    this.#remove = this.#pill('start', '−', 'Remove last column', removeLastColumn);
    this.#render(node);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'columns') return false;
    this.#node = node;
    this.#render(node);
    return true;
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
    const target = record.target;
    return (
      target === this.dom ||
      target === this.#box ||
      target === this.#lines ||
      this.#lines.contains(target) ||
      // The pills and their zones are ours too.
      (target instanceof Element && !!target.closest('.aee-add-zone')) ||
      // The contentDOM's own attributes are ours; its children are ProseMirror's.
      (target === this.contentDOM && record.type === 'attributes')
    );
  }

  #pill(
    side: 'start' | 'end',
    glyph: string,
    label: string,
    command: (pos: number) => Command,
  ): HTMLElement {
    const zone = this.#box.appendChild(document.createElement('div'));
    zone.className = `aee-add-zone aee-add-zone--${side}`;
    zone.contentEditable = 'false';
    zone.setAttribute('aria-hidden', 'true');
    const pill = zone.appendChild(document.createElement('div'));
    pill.className = `aee-add-pill aee-add-pill--${side}`;
    pill.textContent = glyph;
    pill.setAttribute('role', 'button');
    pill.setAttribute('title', label);
    // preventDefault keeps the caret where it is; the command runs on click.
    pill.addEventListener('mousedown', (event) => event.preventDefault());
    pill.addEventListener('click', () => {
      command(this.#getPos())(this.#view.state, this.#view.dispatch);
    });
    return pill;
  }

  #render(node: Node): void {
    this.#box.setAttribute('style', containerStyle(node.attrs['align']));
    // A pill with nothing to do says so: no `+` past the most columns, no
    // `−` on the last one.
    this.#append.toggleAttribute('data-disabled', node.childCount >= MAX_COLUMNS);
    this.#remove.toggleAttribute('data-disabled', node.childCount <= 1);
    // An authored columns block shows its own attributes (authored.ts).
    applyAuthoredAttributes(this.#box, node, 0);

    const caps = columnCaps(node);
    const boundaries = Math.max(caps.length - 1, 0);
    while (this.#lines.children.length > boundaries) this.#lines.lastElementChild!.remove();
    while (this.#lines.children.length < boundaries) {
      const line = this.#lines.appendChild(document.createElement('div'));
      line.className = 'aee-col-line';
      line.addEventListener('pointerdown', (event) => this.#startDrag(line, event));
    }
    let cumulative = 0;
    for (let boundary = 0; boundary < boundaries; boundary++) {
      cumulative += caps[boundary];
      (this.#lines.children[boundary] as HTMLElement).style.left = `${cumulative}px`;
    }
  }

  #startDrag(line: HTMLElement, event: PointerEvent): void {
    event.preventDefault();
    const boundary = Array.prototype.indexOf.call(this.#lines.children, line);
    if (boundary < 0) return;

    const caps = columnCaps(this.#node);
    const pair = caps[boundary] + caps[boundary + 1];
    if (pair < MIN_COLUMN_CAP * 2) return;
    const startX = event.clientX;
    const startLeft = caps.slice(0, boundary + 1).reduce((sum, cap) => sum + cap, 0);

    // px in the editor are px in the email: the box is the 600px container.
    const leftAt = (ev: PointerEvent) =>
      clamp(caps[boundary] + (ev.clientX - startX), MIN_COLUMN_CAP, pair - MIN_COLUMN_CAP);

    const preview = (ev: PointerEvent) => {
      line.style.left = `${startLeft - caps[boundary] + leftAt(ev)}px`;
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', preview);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      line.classList.remove('aee-col-line--drag');
      this.dom.classList.remove('aee-columns-wrap--resizing');
      document.body.style.cursor = bodyCursor;
      setColumnsBoundary(
        this.#getPos(),
        boundary,
        leftAt(ev),
      )(this.#view.state, this.#view.dispatch);
      this.#render(this.#node);
    };

    line.classList.add('aee-col-line--drag');
    this.dom.classList.add('aee-columns-wrap--resizing');
    const bodyCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', preview);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }
}
