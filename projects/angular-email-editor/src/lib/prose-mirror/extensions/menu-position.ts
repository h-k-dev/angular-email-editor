/** A box in viewport coordinates — what `coordsAtPos` answers. */
export interface MenuAnchor {
  left: number;
  top: number;
  bottom: number;
}

/** Where a floating menu goes, in its scroll container's content coordinates. */
export interface MenuPlacement {
  left: number;
  top: number;
  /** The most the box may be tall there: set only when it fits on neither
      side of the line at full height, so it is shrunk to the side with more
      room. Null when it fits as it is. */
  maxHeight: number | null;
  /** Which side of the line it went: under it, or over it. */
  side: 'below' | 'above';
  /** Where the anchor stands across the box, from its left edge — at 0
      unless the box was pushed in from an edge. With `side`, where it
      comes from (a motion's origin). */
  anchorX: number;
}

/**
 * Where a floating menu goes for an anchor line: under it, clamped to its
 * scroll container, flipped above when below would overflow the visible
 * area. When it fits on neither side it goes to the side with more room and
 * says how tall it may be there (`maxHeight`) — flip, then size, as Floating
 * UI does — so the container never clips it.
 *
 * Read-only — it measures and returns, and the caller writes `left` / `top`
 * (and the height cap) in its own write phase, so measuring never follows a
 * write in the same task. The element must be `position: absolute` inside a
 * `position: relative` scroll container; its size is read as rendered, so
 * call it after its contents are in. A caller that caps the box itself
 * passes `height`, the box's height without that cap — a box measured at the
 * last cap would choose its side by the old room, not its own size.
 *
 * The room is what is on screen: the container's visible part, cut down by
 * every scroller round it and by the window. A container that does not
 * scroll itself — an editor that grows with its text inside a scrolling
 * sheet — is as tall as its text, and only its ancestors say where the
 * screen ends (on a phone, at the keyboard).
 */
export function measureMenuPlacement(
  anchor: MenuAnchor,
  element: HTMLElement,
  offset: number,
  height = element.offsetHeight,
): MenuPlacement | null {
  const container = element.offsetParent ?? element.parentElement;
  if (!container) return null;
  const containerRect = container.getBoundingClientRect();
  const width = element.offsetWidth;
  const { scrollLeft, scrollTop, scrollWidth, clientHeight } = container;

  const at = anchor.left - containerRect.left + scrollLeft;
  const left = Math.min(Math.max(at, 0), Math.max(scrollWidth - width, 0));
  const anchorX = Math.min(Math.max(at - left, 0), width);

  // The box's top edge below the line, its bottom edge above it, and the
  // part of the container on screen each leaves.
  const below = anchor.bottom - containerRect.top + scrollTop + offset;
  const above = anchor.top - containerRect.top + scrollTop - offset;
  const visible = visibleSpan(container, containerRect.top, containerRect.top + clientHeight);
  // The span's ends in the container's content coordinates.
  const visibleTop = visible.top - containerRect.top + scrollTop;
  const visibleBottom = visible.bottom - containerRect.top + scrollTop;
  const roomBelow = visibleBottom - below;
  const roomAbove = above - visibleTop;

  const under = { left, anchorX, side: 'below' as const };
  const over = { left, anchorX, side: 'above' as const };
  if (height <= roomBelow) return { ...under, top: below, maxHeight: null };
  if (height <= roomAbove) return { ...over, top: above - height, maxHeight: null };
  // Fits neither: the side with more room, shrunk to it. A line out of
  // sight on both sides leaves no room to shrink to — below, as it is.
  if (roomAbove > roomBelow && roomAbove > 0) {
    return { ...over, top: visibleTop, maxHeight: roomAbove };
  }
  if (roomBelow > 0) return { ...under, top: below, maxHeight: roomBelow };
  return { ...under, top: below, maxHeight: null };
}

/** The part of `top`–`bottom` (viewport coordinates, `element`'s client
    area) left on screen by every ancestor that clips its overflow and by the
    window. */
function visibleSpan(
  element: Element,
  top: number,
  bottom: number,
): { top: number; bottom: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === 'visible') continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top + node.clientTop);
    bottom = Math.min(bottom, rect.top + node.clientTop + node.clientHeight);
  }
  const view = element.ownerDocument.defaultView;
  if (view) {
    top = Math.max(top, 0);
    bottom = Math.min(bottom, view.innerHeight);
  }
  return { top, bottom };
}
