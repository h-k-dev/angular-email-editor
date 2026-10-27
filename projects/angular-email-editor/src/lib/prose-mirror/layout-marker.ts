/**
 * Layout markers — what a layout block *is*, written on it.
 *
 * Without one, a block is known by its shape alone: a section by a one-cell
 * presentation table with a fill, a column by `display: inline-block`, a
 * layout table by having no lines and no room, a layout heading or list by
 * sitting flush. Shapes drift — a hand edit, a style tweaked in the source,
 * a backend adding an attribute, another editor's tables (Summernote draws
 * its borders with a class, so its tables read as having none) — and a
 * block that drifts silently becomes something else: a content table goes
 * static for the writer, a band stops being a band.
 *
 * So every block with a layout variant carries its kind as a class:
 * `aee-layout-section`, `-columns`, `-column` (and the `-card` inside a
 * column of a block with a gap, columns.ts), `-table`, `-heading`,
 * `-list`, `-spacer` — and the page round them all, `-page`, its `-page-column` and the column's `-page-run`s (page-layout.ts). The class goes out with the email too — the stored template and
 * the sent message are one vocabulary — and a class is what survives the
 * clients a message passes through, renamed on the way: Outlook.com writes
 * `x_aee-layout-section`, Gmail `m_<digits>aee-layout-section` in a quoted
 * or forwarded copy. Reading tolerates both (`markedAs`). A `data-*`
 * attribute would not: Gmail drops it.
 *
 * On parse a marker wins over the shape: a marked block is that block,
 * whatever its styles say. An unmarked one falls back to the shape, so
 * imported mail and markup written before the markers read as they always
 * did. Markers never make markup "different" for the preserving parse
 * (`withoutMarkers`): a block written before them is still exactly its
 * canonical rendering, and comes out marked. Markup the preserving parse
 * keeps as authored — not exactly a block's rendering (another builder's,
 * a hand-tuned style) — is written back as it came, the source being law:
 * marked only where it already was.
 */

/** The block kinds a marker names: every block with a layout variant. */
export type LayoutMarkerKind =
  | 'section'
  | 'columns'
  | 'column'
  | 'card'
  | 'table'
  | 'heading'
  | 'list'
  | 'spacer'
  | 'page'
  | 'page-column'
  | 'page-run'
  | 'page-row';

const PREFIX = 'aee-layout-';

/** The marker class of `kind`: `aee-layout-section`. */
export function layoutMarker(kind: LayoutMarkerKind): string {
  return PREFIX + kind;
}

/** A marker class token as it may arrive: ours, or renamed by a client —
    Outlook.com's `x_`, Gmail's `m_<digits>` (signed). */
const MARKER_TOKEN =
  /^(?:x_|m_-?\d+)?aee-layout-(section|columns|column|card|table|heading|list|spacer|page|page-column|page-run|page-row)$/;

function tokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** The kind `element` is marked as — the first marker among its classes —
    or null for an unmarked one. */
export function markedAs(element: Element): LayoutMarkerKind | null {
  for (const token of tokens(element)) {
    const match = MARKER_TOKEN.exec(token);
    if (match) return match[1] as LayoutMarkerKind;
  }
  return null;
}

/** Whether `element` is marked as `kind`. */
export function isMarked(element: Element, kind: LayoutMarkerKind): boolean {
  return markedAs(element) === kind;
}

/** A class attribute's value with every marker taken out, ours or a
    client's — what the preserving parse compares, so a marker never makes
    two openings differ. */
export function withoutMarkers(value: string): string {
  return value
    .split(/\s+/)
    .filter((token) => token && !MARKER_TOKEN.test(token))
    .join(' ');
}

/** The class attribute a rendering of `kind` carries — `{ class }` to
    spread first into its attributes, or nothing where `marked` is false (a
    heading or list that is no layout one, a content table). First, so the
    attribute order a browser and jsdom print is the same (`style` last). */
export function markerAttrs(kind: LayoutMarkerKind, marked = true): { class?: string } {
  return marked ? { class: layoutMarker(kind) } : {};
}
