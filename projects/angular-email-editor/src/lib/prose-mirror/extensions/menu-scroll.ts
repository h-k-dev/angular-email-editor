import { EditorView } from 'prosemirror-view';

/** What a menu lets its scroll behaviour do. */
export interface MenuScrollApi {
  /** Report the menu closed; the next selection change brings it back. */
  close(): void;
  /** Report the menu's box afresh, where it is open. */
  refresh(): void;
}

/**
 * What a floating menu does when what it stands over scrolls — the
 * editor's own scroll container, or the page:
 *
 * - `'close'` (the default): the menu goes. The box it reported is in
 *   viewport coordinates, and stale the moment the editor scrolls under it.
 * - `'follow'`: the box is reported afresh, once per frame, so a host that
 *   repositions on the box's change keeps the menu over the selection.
 * - `'keep'`: nothing — the menu stays where it was reported.
 * - a function: the host's own say, per event — close for the editor's
 *   scroller but follow for the page, or close past a threshold.
 *
 * The listener is the window's, in the capture phase, so every scroll
 * container on the page is heard without being marked (no `cdkScrollable`
 * needed), and only a scroll that moves the editor counts: the document's,
 * or an ancestor's. A scrollable list inside the host's own menu never
 * closes the menu it is in.
 */
export type MenuScroll =
  'close' | 'follow' | 'keep' | ((event: Event, menu: MenuScrollApi) => void);

/** Starts watching for {@link MenuScroll}; returns what stops it. */
export function watchMenuScroll(
  view: EditorView,
  scroll: MenuScroll | undefined,
  menu: MenuScrollApi,
): () => void {
  const mode = scroll ?? 'close';
  if (mode === 'keep') return () => {};
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView ?? window;
  let frame: number | undefined;
  const onScroll = (event: Event) => {
    if (!scrollsEditor(event, view)) return;
    if (typeof mode === 'function') return mode(event, menu);
    if (mode === 'close') return menu.close();
    if (frame !== undefined) return;
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      menu.refresh();
    });
  };
  win.addEventListener('scroll', onScroll, true);
  return () => {
    win.removeEventListener('scroll', onScroll, true);
    if (frame !== undefined) win.cancelAnimationFrame(frame);
  };
}

/** Whether a scroll moves the editor: the document's own, or that of an
    element the editor stands in (the editor's element itself included). */
function scrollsEditor(event: Event, view: EditorView): boolean {
  const target = event.target;
  const doc = view.dom.ownerDocument;
  if (target === doc || target === doc.defaultView) return true;
  return target instanceof Node && target.contains(view.dom);
}
