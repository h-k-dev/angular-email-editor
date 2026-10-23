/**
 * Holds `cursor` over the whole page for a drag's lifetime — over text,
 * controls and all, the way Notion's `grabbing` stays whatever the pointer
 * crosses — and returns the function that lets it go.
 *
 * The body's own cursor loses to any element with one of its own (the text
 * cursor of an editable cell), so the drag is said on the root instead:
 * `data-aee-drag`, with the cursor in `--aee-drag-cursor`, which the host's
 * stylesheet applies to everything (the demo's styles.scss). The body's
 * cursor is set too, for a host without that rule.
 */
export function holdDragCursor(cursor: string): () => void {
  const root = document.documentElement;
  const body = document.body;
  const bodyCursor = body.style.cursor;
  root.style.setProperty('--aee-drag-cursor', cursor);
  root.setAttribute('data-aee-drag', '');
  body.style.cursor = cursor;
  return () => {
    root.removeAttribute('data-aee-drag');
    root.style.removeProperty('--aee-drag-cursor');
    body.style.cursor = bodyCursor;
  };
}
