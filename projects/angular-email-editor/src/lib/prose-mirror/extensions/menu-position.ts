import { EditorView } from 'prosemirror-view';

/**
 * Places a floating menu `element` under the line containing `pos`, clamped
 * to its scroll container and flipped above the line when below would
 * overflow the visible area. One geometry shared by every caret-anchored
 * menu (the slash menu, the merge-tag menu) — the element must be
 * `position: absolute` inside a `position: relative` scroll container.
 */
export function positionMenuAt(
  view: EditorView,
  element: HTMLElement,
  pos: number,
  offset: number,
): void {
  const container = element.offsetParent ?? element.parentElement;
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const coords = view.coordsAtPos(pos);

  const left = Math.min(
    Math.max(coords.left - containerRect.left + container.scrollLeft, 0),
    Math.max(container.scrollWidth - element.offsetWidth, 0),
  );

  // Below the line; flip above when it would overflow the visible part of
  // the scroll container.
  let top = coords.bottom - containerRect.top + container.scrollTop + offset;
  const visibleBottom = container.scrollTop + container.clientHeight;
  if (top + element.offsetHeight > visibleBottom) {
    const above = coords.top - containerRect.top + container.scrollTop;
    if (above - element.offsetHeight - offset >= container.scrollTop) {
      top = above - element.offsetHeight - offset;
    }
  }

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
