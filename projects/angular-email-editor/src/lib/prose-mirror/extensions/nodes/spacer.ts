import { Command, NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { EditorView, NodeView } from 'prosemirror-view';
import { defineNode } from '../../extension';
import { parseDeclarations } from '../../inline-style';
import { layoutMarker, markedAs } from '../../layout-marker';
import { layoutInteractive } from '../layout-interaction';

/** A new spacer's height, px. */
export const SPACER_DEFAULT = 24;
/** The heights a drag settles on: 4px steps (the app's grid), 4 to 160px. */
export const SPACER_STEP = 4;
export const SPACER_MIN = 4;
export const SPACER_MAX = 160;

/** A height a drag (or a command) may set: on the step, inside the range. */
export function snapSpacerHeight(height: number): number {
  const snapped = Math.round(height / SPACER_STEP) * SPACER_STEP;
  return Math.max(SPACER_MIN, Math.min(SPACER_MAX, snapped));
}

/** The spacer as the email carries it — MJML's `mj-spacer` form, with the
    rule Outlook's Word engine needs to honour a line height exactly: one
    line of a non-breaking space, as tall as the gap, its type too small to
    push it taller. */
export const spacerStyle = (height: number): string =>
  `height: ${height}px; line-height: ${height}px; font-size: 1px; mso-line-height-rule: exactly;`;

/** Only blank text: spaces, a non-breaking one, MJML's hair space, the
    zero-width ones. */
const BLANK = /^[\s   ​ ﻿]*$/;

/** A px length, or null. */
const px = (value: string | undefined): number | null => {
  const m = value ? /^(\d+(?:\.\d+)?)px$/i.exec(value.trim()) : null;
  return m ? Math.round(+m[1]) : null;
};

/** The height a parsed spacer stands for: its `height`, else its
    `line-height` — or null where it is no spacer. Marked
    (`aee-layout-spacer`): a spacer, whatever else it holds. Unmarked: a
    `div` with nothing but blank text and a px height — MJML's spacer, a
    builder's. Its height is kept as written (parsing is repair, not
    opinion); only a drag snaps. */
function spacerHeight(dom: HTMLElement): number | null {
  const kind = markedAs(dom);
  if (kind && kind !== 'spacer') return null;
  if (!kind && (dom.children.length || !BLANK.test(dom.textContent ?? ''))) return null;
  const declared = new Map(
    parseDeclarations(dom.getAttribute('style') ?? '').map(({ name, value }) => [name, value]),
  );
  const height = px(declared.get('height')) ?? px(declared.get('line-height'));
  if (height !== null) return Math.max(1, height);
  return kind ? SPACER_DEFAULT : null;
}

/**
 * A spacer: a gap of its own height between two blocks — space that is
 * nobody's margin, so it stays where it was put whatever the blocks around
 * it are (a heading's room, a paragraph's) and whatever a client does with
 * their margins.
 *
 * **In the email** one line: `<div class="aee-layout-spacer" style="height;
 * line-height; font-size: 1px; mso-line-height-rule: exactly">&nbsp;</div>`
 * — `height` for every client that reads it, the exact line height for
 * Outlook's Word engine, which reads only that; valid HTML, nothing in a
 * head, no table. The marker (layout-marker.ts) says what it is.
 *
 * **In the editor** invisible as sent; revealed — a colour-coded band, its
 * height written in it, a handle on its lower edge — while it is selected,
 * under the pointer, or while Ctrl is held (the layout guides' peek). The
 * handle drags its height in 4px steps from 4 to 160px; one drag, one undo
 * step. A layout block: static while layout is off (`setLayoutInteraction`,
 * `spacer`) — no handle, no colour; it still deletes like any block. The
 * app owns the pixels (`.aee-spacer*`); this owns the state.
 */
export const Spacer = defineNode({
  name: 'spacer',
  spec: {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    attrs: { height: { default: SPACER_DEFAULT } },
    parseDOM: [
      {
        tag: 'div',
        // Above the columns (60) and every line rule: a spacer's div is
        // claimed before anything reads it as a line.
        priority: 70,
        getAttrs: (dom) => {
          const height = spacerHeight(dom as HTMLElement);
          return height === null ? false : { height };
        },
      },
    ],
    // An element of its own, its style set as text: a spec's style goes
    // through the CSSOM, which drops what it does not know —
    // `mso-line-height-rule`, the one declaration Outlook needs here.
    toDOM: (node) => {
      const dom = document.createElement('div');
      dom.setAttribute('class', layoutMarker('spacer'));
      dom.setAttribute('style', spacerStyle(node.attrs['height'] as number));
      dom.textContent = ' ';
      return { dom };
    },
  },
  commands: ({ schema }) => ({
    /** A spacer where the selection is — `height` px, snapped. */
    insertSpacer:
      (height = SPACER_DEFAULT): Command =>
      (state, dispatch) => {
        const spacer = schema.nodes['spacer'].create({ height: snapSpacerHeight(height) });
        dispatch?.(state.tr.replaceSelectionWith(spacer).scrollIntoView());
        return true;
      },
    /** The selected spacer's height, snapped. */
    setSpacerHeight:
      (height: number): Command =>
      (state, dispatch) => {
        const { selection } = state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'spacer') {
          return false;
        }
        dispatch?.(
          state.tr.setNodeMarkup(selection.from, undefined, {
            ...selection.node.attrs,
            height: snapSpacerHeight(height),
          }),
        );
        return true;
      },
  }),
  actions: ({ schema }) => [
    {
      id: 'spacer',
      section: 'layout',
      title: 'Spacer',
      keywords: ['spacer', 'space', 'gap', 'vertical', 'whitespace', 'room'],
      icon: 'height',
      command: (state, dispatch) => {
        dispatch?.(state.tr.replaceSelectionWith(schema.nodes['spacer'].create()).scrollIntoView());
        return true;
      },
    },
  ],
  plugins: () => [
    new Plugin({
      key: new PluginKey('spacerView'),
      props: {
        nodeViews: {
          spacer: (node, view, getPos) => new SpacerView(node, view, getPos as () => number),
        },
      },
    }),
  ],
});

/** A drag on the handle, under way. */
interface Drag {
  readonly pointer: number;
  readonly y: number;
  readonly from: number;
  height: number;
}

/**
 * `div.aee-spacer` (the gap, exactly its height) holding the label
 * (`.aee-spacer__label`, "24 px") and the handle on its lower edge
 * (`.aee-spacer__handle`). The height follows the pointer live while the
 * drag runs (`data-dragging`); the document takes it once, on release.
 */
class SpacerView implements NodeView {
  readonly dom: HTMLElement;
  readonly #label: HTMLElement;
  readonly #handle: HTMLElement;
  readonly #view: EditorView;
  readonly #getPos: () => number;
  #node: Node;
  #drag: Drag | null = null;

  constructor(node: Node, view: EditorView, getPos: () => number) {
    this.#node = node;
    this.#view = view;
    this.#getPos = getPos;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement('div');
    this.dom.className = 'aee-spacer';
    this.dom.contentEditable = 'false';
    this.#label = doc.createElement('span');
    this.#label.className = 'aee-spacer__label';
    this.#handle = doc.createElement('div');
    this.#handle.className = 'aee-spacer__handle';
    this.#handle.setAttribute('aria-hidden', 'true');
    this.dom.append(this.#label, this.#handle);
    this.#show(node.attrs['height'] as number);

    this.#handle.addEventListener('pointerdown', (event) => this.#grab(event));
    this.#handle.addEventListener('pointermove', (event) => this.#move(event));
    this.#handle.addEventListener('pointerup', (event) => this.#release(event));
    this.#handle.addEventListener('pointercancel', () => this.#cancel());
  }

  update(node: Node): boolean {
    if (node.type !== this.#node.type) return false;
    this.#node = node;
    if (!this.#drag) this.#show(node.attrs['height'] as number);
    return true;
  }

  /** The handle's own gestures are the view's, never the editor's. */
  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.#handle.contains(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  #show(height: number): void {
    this.dom.style.height = `${height}px`;
    this.#label.textContent = `${height} px`;
  }

  #grab(event: PointerEvent): void {
    if (event.button !== 0 || !layoutInteractive(this.#view.state, 'spacer')) return;
    event.preventDefault();
    // Captured, the pointer's moves come here wherever it goes; a pointer
    // that cannot be (one no longer down) still drags while over the handle.
    try {
      this.#handle.setPointerCapture(event.pointerId);
    } catch {
      // No capture to have: the drag goes on without it.
    }
    const height = this.#node.attrs['height'] as number;
    this.#drag = { pointer: event.pointerId, y: event.clientY, from: height, height };
    this.dom.setAttribute('data-dragging', '');
  }

  #move(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.height = snapSpacerHeight(drag.from + event.clientY - drag.y);
    this.#show(drag.height);
  }

  #release(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    this.#end();
    if (drag.height === drag.from) return;
    const pos = this.#getPos();
    this.#view.dispatch(
      this.#view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.#node.attrs,
        height: drag.height,
      }),
    );
  }

  #cancel(): void {
    if (!this.#drag) return;
    this.#end();
    this.#show(this.#node.attrs['height'] as number);
  }

  #end(): void {
    this.#drag = null;
    this.dom.removeAttribute('data-dragging');
  }

  destroy(): void {
    this.#drag = null;
  }
}
