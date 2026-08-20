/**
 * jsdom ships no layout engine, and ProseMirror measures the DOM whenever a
 * vertical arrow key *might* leave a text block (`EditorView.endOfTextblock`).
 * Gap-cursor asks that on every ArrowUp/ArrowDown, so without this the key
 * never reaches the handlers a spec is actually testing — it throws first, on
 * the two `Range` methods jsdom does not implement.
 *
 * Empty geometry is the honest answer in a DOM that has no geometry: every
 * position measures as nowhere, ProseMirror declines the vertical move, and
 * the key falls through to the keymaps — which is the behaviour under test.
 * Anything genuinely geometric (real carets, real hit-testing) belongs in a
 * browser and can never be proven here; see the preview notes in ROADMAP.
 *
 * Assigned only when missing, so a future jsdom that implements them wins.
 */
const EMPTY_RECT: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => EMPTY_RECT;
