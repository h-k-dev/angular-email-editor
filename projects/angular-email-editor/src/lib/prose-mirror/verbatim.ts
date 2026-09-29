/** Attributes as an ordered list of pairs — JSON-plain, so ProseMirror can
    compare node attrs, and ordered, so the round trip keeps authored order. */
export type AttributePairs = [string, string][];

/**
 * A DOM element with its attributes set **verbatim**. Array output specs run
 * `style` through the CSSOM (`style.cssText = …`), which reformats it and
 * drops every declaration the browser does not know — MJML's `mso-*` hints
 * for Outlook would vanish. Preserved markup therefore builds its own
 * elements; `setAttribute` keeps the string as authored.
 */
export function verbatimElement(
  tag: string,
  attrs: Iterable<[string, string | null | undefined]>,
  content: boolean,
): { dom: HTMLElement; contentDOM?: HTMLElement } {
  const dom = document.createElement(tag);
  for (const [name, value] of attrs) {
    if (value != null) dom.setAttribute(name, value);
  }
  return content ? { dom, contentDOM: dom } : { dom };
}
