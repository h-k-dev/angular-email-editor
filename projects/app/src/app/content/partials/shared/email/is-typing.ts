/**
 * Lets go of the editing surface being typed in — the email editor or the
 * source pane, both contenteditable — so its blur catch-up publishes to the
 * shared html before another view reads it, or before it is hidden. Done
 * before a view switch rather than left to the click: Safari (and Firefox on
 * macOS) never focus a button that is clicked, so the editor would keep
 * focus — and its last edit — through the switch. Only an editing surface
 * is released; a keyboard user standing on a toggle stays on it.
 */
export function releaseEditingSurface(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) active.blur();
}
