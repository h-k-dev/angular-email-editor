/**
 * An avatar's face, made of what a name already holds: its initials — on
 * the name's own hue (`core/randomisation/hue.ts`). The inbox's senders wear
 * one, the template gallery's sets do.
 */

/** A name's initials: the first letters of the first two words of the
    name — or of the address's local part, for a bare address. */
export function initials(name: string): string {
  const words = name
    .replace(/@.*$/, '')
    .split(/[\s._+-]+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toUpperCase();
}
