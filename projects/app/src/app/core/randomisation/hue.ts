/**
 * A colour of its own for anything with a name — no logo, none made up:
 * the name hashed round the wheel. One hue per name, the same every time and
 * everywhere it shows: the inbox's sender avatars, the template gallery's
 * set avatars and the wash a template card lands a press on, so an avatar
 * and what surrounds it are one colour family.
 *
 * Drawn as `oklch(0.58 0.13 var(--avatar-hue))` — a step darker on dark
 * (`oklch(0.48 0.12 …)`), so white reads on it either way.
 */

/** A name's hue, 0–359: FNV-1a of the lower-cased name, mod 360. */
export function hue(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name.toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}
