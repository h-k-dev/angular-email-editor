/** A box in viewport coordinates — what `coordsAtPos` answers. */
export interface MenuAnchor {
  left: number;
  top: number;
  bottom: number;
}

/**
 * Where a floating menu goes for an anchor line: under it, clamped to its
 * scroll container, flipped above when below would overflow the visible
 * area. Read-only — it measures and returns, and the caller writes `left` /
 * `top` in its own write phase, so measuring never follows a write in the
 * same task. The element must be `position: absolute` inside a
 * `position: relative` scroll container; its size is read as rendered, so
 * call it after its contents are in.
 */
export function measureMenuPlacement(
  anchor: MenuAnchor,
  element: HTMLElement,
  offset: number,
): { left: number; top: number } | null {
  const container = element.offsetParent ?? element.parentElement;
  if (!container) return null;
  const containerRect = container.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = element;
  const { scrollLeft, scrollTop, scrollWidth, clientHeight } = container;

  const left = Math.min(
    Math.max(anchor.left - containerRect.left + scrollLeft, 0),
    Math.max(scrollWidth - width, 0),
  );

  // Below the line; flip above when it would overflow the visible part of
  // the scroll container.
  let top = anchor.bottom - containerRect.top + scrollTop + offset;
  if (top + height > scrollTop + clientHeight) {
    const above = anchor.top - containerRect.top + scrollTop;
    if (above - height - offset >= scrollTop) top = above - height - offset;
  }

  return { left, top };
}
