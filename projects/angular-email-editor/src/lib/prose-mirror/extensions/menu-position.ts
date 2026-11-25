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

/** Margin kept from the viewport's edges when floating in the top layer
    (`position: fixed`), px — matches the app's overlay margin. */
const VIEWPORT_MARGIN = 8;

const ZERO_PAD = { top: 0, bottom: 0 };

/**
 * Where a floating menu goes for an anchor line: under it, clamped to what
 * is on screen, flipped above when below would overflow. When it fits on
 * neither side it goes to the side with more room and says how tall it may
 * be there (`maxHeight`) — flip, then size, as Floating UI does — so it is
 * never clipped.
 *
 * Read-only — it measures and returns, and the caller writes `left` / `top`
 * (and the height cap) in its own write phase, so measuring never follows a
 * write in the same task. Its size is read as rendered, so call it after its
 * contents are in. A caller that caps the box itself passes `height`, the
 * box's height without that cap — a box measured at the last cap would
 * choose its side by the old room, not its own size.
 *
 * Two positioning modes, read from `element`'s computed `position`:
 *
 * - **`fixed` (top layer, e.g. `popover="manual"`):** coordinates are the
 *   viewport's. The box escapes every ancestor stacking context and overflow
 *   clip (including `container-type`, `isolation: isolate`, and floating
 *   toolbars). It still prefers the room clear of any scroll container's
 *   `scroll-padding` (floating foot, sticky bar) so it flips off the toolbar
 *   when it fits above; when neither clear side holds it, it uses the full
 *   viewport — cleanly floating over a footer toolbar or past a short box's
 *   edge — and only shrinks when even the viewport cannot hold it. Returns
 *   `null` if the anchor has scrolled out of a clipping ancestor's sight.
 * - **`absolute` (inside a `position: relative` container):** coordinates
 *   are the container's content coordinates, bounded by the container's
 *   visible part, every clipping ancestor, their `scroll-padding` (on scroll
 *   containers only), and the window.
 */
export function measureMenuPlacement(
  anchor: MenuAnchor,
  element: HTMLElement,
  offset: number,
  height = element.offsetHeight,
): MenuPlacement | null {
  if (getComputedStyle(element).position === 'fixed') {
    return measureFixedPlacement(anchor, element, offset, height);
  }
  const container = element.offsetParent ?? element.parentElement;
  if (!container) return null;
  const containerRect = container.getBoundingClientRect();
  const width = element.offsetWidth;
  const { scrollLeft, scrollTop, clientWidth, clientHeight } = container;

  // Across, the box keeps to what is on screen of the container, as it does
  // down it — never to all the container scrolls to: an email wider than
  // its paper scrolls sideways, and a box held to that width stood past the
  // paper's edge, cut off there (and, standing there, widened the very
  // width it was held to).
  const at = anchor.left - containerRect.left + scrollLeft;
  const shown = visibleAcross(container, containerRect.left, containerRect.left + clientWidth);
  const shownLeft = shown.left - containerRect.left + scrollLeft;
  const shownRight = shown.right - containerRect.left + scrollLeft;
  const left = Math.min(Math.max(at, shownLeft), Math.max(shownRight - width, shownLeft));
  const anchorX = Math.min(Math.max(at - left, 0), width);

  // The box's top edge below the line, its bottom edge above it, and the
  // part of the container on screen each leaves. `scroll-padding` only
  // applies to scroll containers: a growing `overflow: visible` editor leaves
  // its foot clearance to the scroller round it.
  const below = anchor.bottom - containerRect.top + scrollTop + offset;
  const above = anchor.top - containerRect.top + scrollTop - offset;
  const containerStyle = getComputedStyle(container);
  const pad = scrollsY(containerStyle.overflowY) ? scrollPadding(containerStyle) : ZERO_PAD;
  const visible = visibleSpan(
    container,
    containerRect.top + pad.top,
    containerRect.top + clientHeight - pad.bottom,
  );
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

/** Top-layer (`position: fixed`) placement in viewport coordinates. */
function measureFixedPlacement(
  anchor: MenuAnchor,
  element: HTMLElement,
  offset: number,
  height: number,
): MenuPlacement | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  const width = element.offsetWidth;
  const marginX = Math.min(VIEWPORT_MARGIN, view.innerWidth / 4);
  const marginY = Math.min(VIEWPORT_MARGIN, view.innerHeight / 4);
  const viewLeft = marginX;
  const viewRight = view.innerWidth - marginX;
  const viewTop = marginY;
  const viewBottom = view.innerHeight - marginY;

  let clipTop = -Infinity;
  let clipBottom = Infinity;
  let clipLeft = -Infinity;
  let clipRight = Infinity;
  let clearTop = viewTop;
  let clearBottom = viewBottom;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const clipsY = clipsAxis(style.overflowY);
    const clipsX = clipsAxis(style.overflowX);
    if (!clipsY && !clipsX) continue;
    const rect = node.getBoundingClientRect();
    if (clipsY && node.clientHeight > 0) {
      const top = rect.top + node.clientTop;
      const bottom = top + node.clientHeight;
      clipTop = Math.max(clipTop, top);
      clipBottom = Math.min(clipBottom, bottom);
      const pad = scrollsY(style.overflowY) ? scrollPadding(style) : ZERO_PAD;
      clearTop = Math.max(clearTop, top + pad.top);
      clearBottom = Math.min(clearBottom, bottom - pad.bottom);
    }
    if (clipsX && node.clientWidth > 0) {
      const left = rect.left + node.clientLeft;
      const right = left + node.clientWidth;
      clipLeft = Math.max(clipLeft, left);
      clipRight = Math.min(clipRight, right);
    }
  }

  // Caret scrolled out of its clipping ancestor's visible box: hide until it
  // scrolls back into sight.
  if (
    anchor.bottom <= clipTop ||
    anchor.top >= clipBottom ||
    anchor.left < clipLeft - 1 ||
    anchor.left > clipRight + 1
  ) {
    return null;
  }

  const at = anchor.left;
  const left = Math.min(Math.max(at, viewLeft), Math.max(viewRight - width, viewLeft));
  const anchorX = Math.min(Math.max(at - left, 0), width);

  const below = anchor.bottom + offset;
  const above = anchor.top - offset;
  const clearBelow = clearBottom - below;
  const clearAbove = above - clearTop;
  const viewBelow = viewBottom - below;
  const viewAbove = above - viewTop;

  const under = { left, anchorX, side: 'below' as const };
  const over = { left, anchorX, side: 'above' as const };

  // 1. Prefer a full-height side clear of any floating foot or sticky bar.
  if (height <= clearBelow) return { ...under, top: below, maxHeight: null };
  if (height <= clearAbove) return { ...over, top: above - height, maxHeight: null };

  // 2. Top-layer: fit at full height in the viewport (floating over a footer
  //    toolbar or past a short container's edge).
  if (height <= viewBelow) return { ...under, top: below, maxHeight: null };
  if (height <= viewAbove) return { ...over, top: above - height, maxHeight: null };

  // 3. Fits neither side of the viewport: the side with more room, shrunk.
  if (viewAbove > viewBelow && viewAbove > 0) {
    return { ...over, top: viewTop, maxHeight: viewAbove };
  }
  if (viewBelow > 0) return { ...under, top: below, maxHeight: viewBelow };
  return { ...under, top: below, maxHeight: null };
}

/** The part of `top`–`bottom` (viewport coordinates, `element`'s client
    area) left on screen by every ancestor that clips its overflow — less
    what its scroll padding says is covered — and by the window. */
function visibleSpan(
  element: Element,
  top: number,
  bottom: number,
): { top: number; bottom: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!clipsAxis(style.overflowY)) continue;
    const rect = node.getBoundingClientRect();
    const pad = scrollsY(style.overflowY) ? scrollPadding(style) : ZERO_PAD;
    top = Math.max(top, rect.top + node.clientTop + pad.top);
    bottom = Math.min(bottom, rect.top + node.clientTop + node.clientHeight - pad.bottom);
  }
  const view = element.ownerDocument.defaultView;
  if (view) {
    top = Math.max(top, 0);
    bottom = Math.min(bottom, view.innerHeight);
  }
  return { top, bottom };
}

/** Whether an axis clips overflow — an engine without layout (jsdom)
    computes `''` and no box to clip to either. */
const clipsAxis = (overflow: string): boolean => overflow !== 'visible' && overflow !== '';

/** Whether CSS `scroll-padding` applies to `overflowY` — only scroll
    containers (`visible` and `clip` never scroll). */
const scrollsY = (overflow: string): boolean => overflow !== 'visible' && overflow !== 'clip';

/** What a scroller says its top and bottom edges are covered by, px — its
    `scroll-padding`, as a host sets it for what is stuck there (a floating
    foot, a sticky bar). `auto`, and a length that is no px, is none. */
function scrollPadding(style: CSSStyleDeclaration): { top: number; bottom: number } {
  const px = (value: string) => (value.endsWith('px') ? parseFloat(value) || 0 : 0);
  return { top: px(style.scrollPaddingTop), bottom: px(style.scrollPaddingBottom) };
}

/** The part of `left`–`right` (viewport coordinates, `element`'s client
    area) left on screen by every ancestor that clips its overflow and by the
    window — {@link visibleSpan}, across. */
function visibleAcross(
  element: Element,
  left: number,
  right: number,
): { left: number; right: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (!clipsAxis(getComputedStyle(node).overflowX)) continue;
    const rect = node.getBoundingClientRect();
    left = Math.max(left, rect.left + node.clientLeft);
    right = Math.min(right, rect.left + node.clientLeft + node.clientWidth);
  }
  const view = element.ownerDocument.defaultView;
  if (view) {
    left = Math.max(left, 0);
    right = Math.min(right, view.innerWidth);
  }
  return { left, right };
}
