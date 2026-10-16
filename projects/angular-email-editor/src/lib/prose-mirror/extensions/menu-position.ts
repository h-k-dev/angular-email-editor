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

  const left = Math.min(
    Math.max(anchor.left - containerRect.left + scrollLeft, 0),
    Math.max(scrollWidth - width, 0),
  );

  // The box's top edge below the line, its bottom edge above it, and the
  // visible part of the scroll container each leaves.
  const below = anchor.bottom - containerRect.top + scrollTop + offset;
  const above = anchor.top - containerRect.top + scrollTop - offset;
  const roomBelow = scrollTop + clientHeight - below;
  const roomAbove = above - scrollTop;

  if (height <= roomBelow) return { left, top: below, maxHeight: null };
  if (height <= roomAbove) return { left, top: above - height, maxHeight: null };
  // Fits neither: the side with more room, shrunk to it. A line out of
  // sight on both sides leaves no room to shrink to — below, as it is.
  if (roomAbove > roomBelow && roomAbove > 0) return { left, top: scrollTop, maxHeight: roomAbove };
  if (roomBelow > 0) return { left, top: below, maxHeight: roomBelow };
  return { left, top: below, maxHeight: null };
}
