/**
 * Custom colours — the ones an author picks outside the palette — are
 * written like any colour: the light one, as picked. Nothing in the email
 * marks them: dark is never declared, only drawn (Dawn, dark-rendering.ts),
 * so a custom colour is drawn dark exactly as a palette one is.
 *
 * Emails saved while the editor still declared dark carry stamps on the
 * elements that wore a custom colour — `data-aee-color` for the text,
 * `data-aee-fill` for the fill. They mean nothing now, and come off on
 * parse.
 */

/** The stamps an older email's custom colours carry. */
const STAMPS = ['data-aee-color', 'data-aee-fill'];

/** Takes an older email's custom-colour stamps off, before anything else
    reads the markup (parseHTML). */
export function stripCustomColorStamps(root: Element): void {
  for (const element of Array.from(root.querySelectorAll(STAMPS.map((stamp) => `[${stamp}]`).join(', ')))) {
    for (const stamp of STAMPS) element.removeAttribute(stamp);
  }
}
