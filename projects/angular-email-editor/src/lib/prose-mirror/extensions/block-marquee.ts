import { Plugin, PluginKey, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { BlockSelection } from './block-selection';
import { claimPress } from './press-claim';

/** The class of the box a drag draws — the host paints it, in the same wash
    as the blocks it lights ({@link BLOCK_SELECTED_CLASS}). */
export const BLOCK_MARQUEE_CLASS = 'aee-marquee';

export interface BlockMarqueeOptions {
  /**
   * Where a press may start the box: the margin around the editor, and the
   * editor's own room between and below its blocks. The editor's parent
   * element, by default — the composer's scrolling paper. Only the blocks
   * the box covers *inside* the surface's viewport are selected, and held
   * near its scroller's edge the drag scrolls it.
   */
  surface?: (view: EditorView) => HTMLElement;
  /**
   * What the box is drawn in, once the press has started it — any ancestor
   * of the surface, or the surface itself (the default). Notion's way: the
   * drag can only start in the editor's room, but the box follows the
   * pointer anywhere on the canvas — over a header, the fields above the
   * text, a side bar — while it still selects only the editor's blocks. The
   * pointer is clipped to the canvas's viewport.
   *
   * The box is absolutely positioned against its containing block, so give
   * the canvas a `position`; its `overflow` clips the box. The box wears the
   * editor's `color-scheme`, wherever it is drawn, so its wash is the one
   * the blocks it lights wear.
   */
  canvas?: (view: EditorView) => HTMLElement;
  /** How far, in px, a press moves before it is a box and not a click.
      4, by default: a hand at rest still moves a pixel or two. */
  threshold?: number;
}

/** What a press on the surface may not start: its own controls. */
const INTERACTIVE =
  'button, a[href], input, textarea, select, label, summary, [role="button"], [contenteditable]';

/** How close to the scroller's edge, in px, a held drag scrolls it — and
    the fastest it goes, in px per frame, at (or past) the edge. */
const EDGE = 40;
const MAX_SPEED = 20;

interface Point {
  x: number;
  y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The client box of what an element shows of its content: inside its
    borders, without its scrollbars. */
function viewport(element: Element): Box {
  const rect = element.getBoundingClientRect();
  const left = rect.left + element.clientLeft;
  const top = rect.top + element.clientTop;
  return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
}

/** Whether a press landed on the element's scrollbar (outside its client
    box but inside its border box). */
function onScrollbar(element: Element, event: MouseEvent): boolean {
  const inner = viewport(element);
  return event.clientX >= inner.right || event.clientY >= inner.bottom;
}

/** The nearest ancestor (or the element) that scrolls vertically. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/** How far `scroller` (or, with none, the window) has scrolled. */
function scrollOf(scroller: HTMLElement | null): Point {
  return scroller
    ? { x: scroller.scrollLeft, y: scroller.scrollTop }
    : { x: window.scrollX, y: window.scrollY };
}

/** Starts a gesture from a press; `elsewhere` — a host's own start point,
    not the surface or the editor. */
type Start = (event: MouseEvent, elsewhere: boolean) => boolean;

/** Each marquee editor's start, for {@link beginBlockMarquee}. */
const starts = new WeakMap<EditorView, Start>();

/** A drag in progress, from its press. */
interface Gesture {
  /** The press, in client coordinates: the click's slack is measured here,
      and the box grows from it — moved by however far the content has
      scrolled since (`scrolledFrom`), so it stays where it was pressed in
      the content. */
  pressed: Point;
  /** The scroller's scroll at the press. */
  scrolledFrom: Point;
  /** Where the pointer is, in client coordinates. */
  pointer: Point;
  /** Past the slack: a box, not a click. */
  moved: boolean;
  box: HTMLElement | null;
  /** The selection the press found, kept while the box covers no block. */
  before: Selection;
  scroller: HTMLElement | null;
  frameRequest: number | null;
  stop: () => void;
}

/**
 * Notion's marquee: a drag from the empty room around the text draws a box,
 * and every top-level block it touches is selected — a {@link BlockSelection},
 * lit block by block in the box's own wash. Opt-in, with
 * {@link SelectedBlocks} in the kit (which this needs for the keys and the
 * lit blocks).
 *
 * **Where it starts.** A press on the surface outside the editor (its
 * margin), or on the editor's own box between and below its blocks — never
 * on a block: a press on text is the text's, and a drag across lines stays a
 * text selection, as email users expect. Nor on a control of the surface's,
 * a scrollbar, or with a modifier held. The press is kept from the browser
 * and ProseMirror alike (no caret jump, no native selection), so a press
 * released in place is placed here: the caret at the nearest spot in the
 * text, as a click in the margin of a page puts it in Google Docs.
 *
 * **While it drags.** The box is a `div` ({@link BLOCK_MARQUEE_CLASS}) in the
 * canvas — the surface, unless the host gives a larger one — against the
 * pointer, clipped to the canvas's viewport, so it may reach over whatever
 * frames the editor; held near the scroller's edge (or past it) it scrolls,
 * and the box keeps its origin in the content. Each move hit-tests the
 * top-level blocks' boxes (the one measured thing — a box drawn by a pointer
 * has no other geometry) against what the box covers of the surface, and
 * selects the run it touches; touching none, the selection the press found
 * comes back. Only blocks are ever selected, wherever the box reaches.
 * Escape cancels the drag.
 */
export const createBlockMarquee = (options: BlockMarqueeOptions = {}): FunctionalExtension => {
  const threshold = options.threshold ?? 4;

  return defineExtension({
    name: 'blockMarquee',
    plugins: () => {
      // The press handler of this editor's view (one per `plugins` call).
      let begin: Start | null = null;
      return [
        new Plugin({
          key: new PluginKey('blockMarquee'),
          view: (view) => {
            const surface = options.surface?.(view) ?? view.dom.parentElement ?? view.dom;
            const canvas = options.canvas?.(view) ?? surface;
            let gesture: Gesture | null = null;

            /** The containing block the box is positioned against, and how
                its frame (the content's, scrolled) maps from the client. */
            const frame = (box: HTMLElement) => {
              const host = box.offsetParent;
              if (!host || host === document.body || host === document.documentElement) {
                return { x: window.scrollX, y: window.scrollY };
              }
              const rect = host.getBoundingClientRect();
              return {
                x: host.scrollLeft - rect.left - host.clientLeft,
                y: host.scrollTop - rect.top - host.clientTop,
              };
            };

            const update = (current: Gesture) => {
              const box = current.box;
              if (!box || view.isDestroyed) return;
              // The press, where the content has carried it since.
              const scroll = scrollOf(current.scroller);
              const origin = {
                x: current.pressed.x - (scroll.x - current.scrolledFrom.x),
                y: current.pressed.y - (scroll.y - current.scrolledFrom.y),
              };
              /** The box from the press to the pointer, clipped to `clip`. */
              const span = (clip: Box): Box & { pointer: Point } => {
                const pointer = {
                  x: clamp(current.pointer.x, clip.left, clip.right),
                  y: clamp(current.pointer.y, clip.top, clip.bottom),
                };
                return {
                  pointer,
                  left: Math.min(origin.x, pointer.x),
                  top: Math.min(origin.y, pointer.y),
                  right: Math.max(origin.x, pointer.x),
                  bottom: Math.max(origin.y, pointer.y),
                };
              };

              // Drawn on the canvas, as far as the pointer goes on it…
              const drawn = span(viewport(canvas));
              const offset = frame(box);
              box.style.left = `${drawn.left + offset.x}px`;
              box.style.top = `${drawn.top + offset.y}px`;
              box.style.width = `${drawn.right - drawn.left}px`;
              box.style.height = `${drawn.bottom - drawn.top}px`;

              // …but it selects what it covers of the surface: the blocks
              // the editor shows. Past the surface's edge, the scroll brings
              // the rest in (`autoScroll`).
              const area = span(viewport(surface));
              const { pointer } = area;
              const { doc } = view.state;
              const hits: number[] = [];
              doc.forEach((_node, pos) => {
                const dom = view.nodeDOM(pos);
                if (!(dom instanceof Element)) return;
                const rect = dom.getBoundingClientRect();
                if (
                  rect.bottom > area.top &&
                  rect.top < area.bottom &&
                  rect.right > area.left &&
                  rect.left < area.right
                ) {
                  hits.push(pos);
                }
              });
              let next: Selection = current.before;
              if (hits.length) {
                // Dragged upward, the head is the top block: Shift-arrows
                // then move the end the pointer was at.
                const upward = pointer.y < origin.y;
                const first = hits[0];
                const last = hits[hits.length - 1];
                next = upward
                  ? BlockSelection.create(doc, last, first)
                  : BlockSelection.create(doc, first, last);
              } else if (current.before.$anchor.doc !== doc) {
                return;
              }
              if (!next.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(next));
            };

            /** Scrolls the scroller while the pointer is held at its edge,
                one step a frame, then hit-tests again. */
            const autoScroll = (current: Gesture) => {
              current.frameRequest = null;
              const scroller = current.scroller;
              if (!scroller || gesture !== current || !current.moved) return;
              const edges = viewport(scroller);
              const y = current.pointer.y;
              let step = 0;
              if (y < edges.top + EDGE) step = -Math.min(MAX_SPEED, (edges.top + EDGE - y) / 2);
              else if (y > edges.bottom - EDGE) {
                step = Math.min(MAX_SPEED, (y - (edges.bottom - EDGE)) / 2);
              }
              if (!step) return;
              const before = scroller.scrollTop;
              scroller.scrollTop += step;
              if (scroller.scrollTop === before) return;
              update(current);
              current.frameRequest = requestAnimationFrame(() => autoScroll(current));
            };

            const start: Start = (event, elsewhere) => {
              if (gesture || !view.editable) return false;
              if (event.button !== 0 || event.detail > 1) return false;
              if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
              // The surface's scrollbar is the scroller's; a start point
              // elsewhere is the host's to judge.
              if (!elsewhere && onScrollbar(surface, event)) return false;
              // No caret jump, no native selection, no focus leaving: the
              // press is the box's (or, released in place, placed below).
              event.preventDefault();
              claimPress(event);

              const pressed = { x: event.clientX, y: event.clientY };
              const scroller = scrollerOf(surface);
              const current: Gesture = {
                pressed,
                scrolledFrom: scrollOf(scroller),
                pointer: pressed,
                moved: false,
                box: null,
                before: view.state.selection,
                scroller,
                frameRequest: null,
                stop: () => {},
              };

              const move = (moved: MouseEvent) => {
                if (view.isDestroyed) return finish();
                current.pointer = { x: moved.clientX, y: moved.clientY };
                if (!current.moved) {
                  if (
                    Math.abs(current.pointer.x - pressed.x) < threshold &&
                    Math.abs(current.pointer.y - pressed.y) < threshold
                  ) {
                    return;
                  }
                  current.moved = true;
                  const box = document.createElement('div');
                  box.className = BLOCK_MARQUEE_CLASS;
                  box.setAttribute('aria-hidden', 'true');
                  box.style.position = 'absolute';
                  box.style.pointerEvents = 'none';
                  // The editor's scheme, wherever the box is drawn: the
                  // canvas may wear another (an app theme round a light
                  // paper), and the wash is a light-dark() pair.
                  box.style.colorScheme = getComputedStyle(view.dom).colorScheme;
                  canvas.appendChild(box);
                  current.box = box;
                  // The keys (Delete, Shift-arrows) go to the selection.
                  view.focus();
                }
                update(current);
                if (current.frameRequest === null) {
                  current.frameRequest = requestAnimationFrame(() => autoScroll(current));
                }
              };
              const scrolled = () => update(current);
              const up = () => {
                finish();
                // A click: the caret at the nearest spot in the text — the
                // point brought onto the editor's box when it fell outside.
                // Not from a start point elsewhere: a click beside a form is
                // no click in the text, and leaves everything as it was.
                if (view.isDestroyed || current.moved || elsewhere) return;
                const rect = view.dom.getBoundingClientRect();
                const found = view.posAtCoords({
                  left: clamp(pressed.x, rect.left + 1, rect.right - 1),
                  top: clamp(pressed.y, rect.top + 1, rect.bottom - 1),
                });
                const { doc } = view.state;
                const caret = found
                  ? Selection.near(doc.resolve(found.pos))
                  : pressed.y < rect.top
                    ? Selection.atStart(doc)
                    : Selection.atEnd(doc);
                view.focus();
                if (!caret.eq(view.state.selection)) {
                  view.dispatch(view.state.tr.setSelection(caret));
                }
              };
              const key = (pressedKey: KeyboardEvent) => {
                if (pressedKey.key !== 'Escape') return;
                pressedKey.preventDefault();
                pressedKey.stopPropagation();
                finish();
                if (!view.isDestroyed && !current.before.eq(view.state.selection)) {
                  if (current.before.$anchor.doc === view.state.doc) {
                    view.dispatch(view.state.tr.setSelection(current.before));
                  }
                }
              };
              const finish = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                window.removeEventListener('keydown', key, true);
                window.removeEventListener('scroll', scrolled, true);
                if (current.frameRequest !== null) cancelAnimationFrame(current.frameRequest);
                current.frameRequest = null;
                current.box?.remove();
                current.box = null;
                if (gesture === current) gesture = null;
              };
              current.stop = finish;
              window.addEventListener('mousemove', move);
              window.addEventListener('mouseup', up);
              window.addEventListener('keydown', key, true);
              // Any scroll under the drag (the wheel, the autoscroll) moves
              // the content under a still pointer: the box follows.
              window.addEventListener('scroll', scrolled, true);
              gesture = current;
              return true;
            };

            // A press outside the editor: the surface's. The editor's own
            // presses come through `handleDOMEvents`, ahead of ProseMirror's.
            const outside = (event: MouseEvent) => {
              const target = event.target as Element | null;
              if (!target || view.dom.contains(target)) return;
              const control = target.closest(INTERACTIVE);
              if (control && surface.contains(control)) return;
              start(event, false);
            };

            begin = start;
            starts.set(view, start);
            surface.addEventListener('mousedown', outside);
            return {
              destroy() {
                surface.removeEventListener('mousedown', outside);
                gesture?.stop();
                starts.delete(view);
                begin = null;
              },
            };
          },
          props: {
            handleDOMEvents: {
              // The editor's own box — the room between and below its
              // blocks, never a block — starts the box. Returning true keeps
              // ProseMirror's own press handling (the caret) out of it.
              mousedown: (view, event) => event.target === view.dom && !!begin?.(event, false),
            },
          },
        }),
      ];
    },
  });
};

/**
 * Starts the editor's marquee from a press anywhere else — a start point of
 * the host's own: the room beside a page's text column, the empty room round
 * a form — as Notion lets a drag start in a page's margins. The host decides
 * the press is one (its own empty room, not a control); from there it is the
 * surface's gesture in every way: the box on the canvas, the blocks it
 * covers of the surface, the scroll, Escape. Released in place it does
 * nothing — only the editor's own room puts the caret on a line.
 *
 * Call it from the start point's `mousedown`. It returns whether the box
 * started (and then took the press: `preventDefault`); `false` without
 * {@link createBlockMarquee} in the editor, while one is already drawn, in a
 * read-only editor, and for a press that is not a plain primary one (another
 * button, a double click, a modifier held).
 */
export function beginBlockMarquee(view: EditorView, event: MouseEvent): boolean {
  return starts.get(view)?.(event, true) ?? false;
}
