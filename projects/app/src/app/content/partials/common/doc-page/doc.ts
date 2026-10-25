/** A heading under a section the table of contents lists — one export, one
    group of tokens. */
export interface DocTopic {
  /** The element's id, and the URL's #fragment. */
  readonly id: string;
  readonly title: string;
  /** Set in code type: an export's or a class's name. */
  readonly code?: boolean;
}

/** A section of a reference page, as its table of contents lists it. */
export interface DocSection {
  readonly id: string;
  readonly title: string;
  readonly topics?: readonly DocTopic[];
}

/** A run of prose: plain text, or code (`…` in the source string). */
export interface ProsePart {
  readonly text: string;
  readonly code: boolean;
}

/** Prose written with `backticks` for code, as its parts. */
export function prose(text: string): readonly ProsePart[] {
  return text
    .split('`')
    .map((part, index) => ({ text: part, code: index % 2 === 1 }))
    .filter((part) => part.text !== '');
}
