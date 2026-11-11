import { Fragment, Mark, MarkType, Node, Schema, Slice } from 'prosemirror-model';
import {
  Command,
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension, defineMark } from '../extension';
import { AUTHORED_ATTR } from '../authored';
import { GUIDES_PEEK_EVENT, isPeeking } from './layout-guides';
import { mergeTagRanges, scanMergeTags } from './nodes/merge-tag';

/**
 * Fills the document's placeholders in with their values — the step a CRM
 * runs before a templated mail goes out ("Platzhalter einsetzen").
 *
 * A host whose evaluator takes text (core's TextParser: `parseStrings`)
 * would otherwise push the whole HTML body through it and take new HTML
 * back. That loses three ways: an expression with `&&`, `>` or `<` arrives
 * entity-escaped (`&amp;&amp;`) and fails to compile, a value is spliced
 * into the markup unescaped, and the swapped body takes the undo history
 * with it. Here the tokens are read off the document, where they are text:
 *
 * - the host is asked for each distinct expression **once, raw** —
 *   `cf_3 > 0 && cf_4 ? 'x' : ''`, never an entity in sight;
 * - each value goes in **as text**, in the token's place and with its
 *   formatting (a bold `{{ customer_lastName }}` becomes the bold name), a
 *   line break in a value a hard break;
 * - all of it is **one transaction**: one Mod-Z brings the tokens back;
 * - a value that comes back **empty leaves its token** — an evaluator says
 *   `''` for a field without a value as for one that computes to nothing,
 *   so the fill cannot tell a gap from an intent. The writer decides: write
 *   a value by hand ({@link writeMergeTag}), or remove the token
 *   ({@link removeMergeTag}) — an empty value is always explicit;
 * - a host that **can** tell says so: {@link REMOVE_MERGE_TAG} for an
 *   expression takes its tokens out in the same transaction, the text
 *   closed up behind them.
 *
 * Tokens in running text and in any string attribute of a node or mark — a
 * link's or a button's `href`, a button's label, an image's `src` or `alt`
 * — are filled alike, everywhere a renderer of the HTML would have looked.
 * With a selection holding tokens, only those are filled; else the whole
 * document.
 *
 * The request is asynchronous: the user may go on writing while the host
 * answers. The scope is mapped through every change made meanwhile, tokens
 * are found again when the values arrive, and a token edited in between is
 * left alone (its expression is not the one asked for). One request at a
 * time — {@link mergeTagResolutionPending} says when one is out.
 *
 * Bound to Mod-Shift-Enter — beside Mod-Enter's send, "fill in, then send";
 * free in every browser and on every keyboard layout — and declared as the
 * `resolve-placeholders` action, so it is a `/` menu row and a toolbar
 * button with no further wiring.
 */

// ---------------------------------------------------------------------------
// What a value was

/**
 * Where a filled-in value came from: the token it took the place of. Each
 * fill is one occurrence with an **id** of its own — a value split in pieces
 * (a line break in it, bold put on half of it later) is still one value,
 * and the same expression filled twice is two, restored apart.
 *
 * Editor-only (`emitDOM: null`): the email carries the value, nothing of
 * where it came from. It rides the undo history, the clipboard (a paste
 * takes fresh ids: a copy is a fill of its own), and survives clearing the
 * formatting — it is not formatting. Not kept across a reload: the draft is
 * stored as the email's HTML.
 *
 * It also keeps the **value as filled**, so a value written over by hand
 * is known without a flag: its text is no longer that value. The writer may
 * hand-roll it ({@link editFilledValue}) and it is still the token's — or
 * take the filled value back ({@link resetFilledValue}), or the token
 * ({@link restoreMergeTag}). An edited value carries the class
 * {@link FILLED_EDITED_CLASS} (a decoration over the whole of it).
 *
 * Painted by the host only while Ctrl is held — the layout guides' peek
 * (`.aee-guides-peek .aee-filled-merge-tag`) — and reported to it on hover
 * then ({@link MergeTagResolutionOptions.onFilledHover}), with those ways.
 */
export const FilledMergeTag = defineMark({
  name: 'filledMergeTag',
  spec: {
    attrs: { id: { default: '' }, expr: { default: '' }, value: { default: '' } },
    // Typing at either end of a value is the writer's own text.
    inclusive: false,
    // Enter at the end of a value starts the next line without it.
    splittable: false,
    // Not formatting: "Clear formatting" leaves it.
    clearable: false,
    parseDOM: [
      {
        tag: 'span[data-aee-filled]',
        getAttrs: (dom: HTMLElement) => ({
          id: dom.getAttribute('data-aee-filled') ?? '',
          expr: dom.getAttribute('data-aee-expr') ?? '',
          value: dom.getAttribute('data-aee-value') ?? '',
        }),
      },
    ],
    toDOM: (mark) => [
      'span',
      {
        class: 'aee-filled-merge-tag',
        'data-aee-filled': mark.attrs['id'],
        'data-aee-expr': mark.attrs['expr'],
        'data-aee-value': mark.attrs['value'],
      },
      0,
    ],
    emitDOM: null,
  },
  plugins: ({ schema }) => {
    const type = schema.marks['filledMergeTag'];
    return [
      new Plugin<DecorationSet>({
        state: {
          init: (_, state) => editedValues(state.doc),
          apply: (tr, set) => (tr.docChanged ? editedValues(tr.doc) : set),
        },
        props: {
          transformPasted: (slice) =>
            new Slice(freshFillIds(slice.content, type, new Map()), slice.openStart, slice.openEnd),
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

/** The class on a filled value written over by hand — its text no longer
    the value filled in. */
export const FILLED_EDITED_CLASS = 'aee-filled-merge-tag--edited';

/** Every edited value, decorated whole. A walk of the document's text on
    each change — fills are few, and nothing is measured. */
function editedValues(doc: Node): DecorationSet {
  const type = doc.type.schema.marks['filledMergeTag'];
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.inlineContent) return true;
    let offset = 0;
    for (let index = 0; index < node.childCount; index++) {
      const child = node.child(index);
      const at = pos + 1 + offset;
      offset += child.nodeSize;
      if (!type.isInSet(child.marks)) continue;
      const filled = filledMergeTagAt(doc, at);
      if (!filled) continue;
      if (filled.edited) found.push(Decoration.inline(filled.from, filled.to, { class: FILLED_EDITED_CLASS }));
      // On past the rest of this value.
      while (index + 1 < node.childCount && pos + 1 + offset < filled.to) {
        offset += node.child(++index).nodeSize;
      }
    }
    return false;
  });
  return DecorationSet.create(doc, found);
}

let fills = 0;
/** A fill's id: unique in the page, never across reloads (it is not stored). */
const nextFillId = (): string => `fill-${++fills}`;

/** `fragment` with every fill's id swapped for a fresh one — one per
    original id, so a pasted value split in pieces stays one value. */
function freshFillIds(fragment: Fragment, type: MarkType, ids: Map<string, string>): Fragment {
  const nodes: Node[] = [];
  fragment.forEach((node) => {
    let next = node.isText || !node.content.size ? node : node.copy(freshFillIds(node.content, type, ids));
    const mark = type.isInSet(next.marks);
    if (mark) {
      let id = ids.get(mark.attrs['id']);
      if (!id) ids.set(mark.attrs['id'], (id = nextFillId()));
      next = next.mark(type.create({ ...mark.attrs, id }).addToSet(next.marks));
    }
    nodes.push(next);
  });
  return Fragment.from(nodes);
}

/** A filled value in the document: where it stands, which fill, and what
    its token was. */
export interface FilledMergeTagRange {
  from: number;
  to: number;
  id: string;
  /** The expression, trimmed — as the host was asked. */
  expr: string;
  /** The value as filled in, a line break as `\n`. */
  value: string;
  /** The value's text now, a line break as `\n`. */
  text: string;
  /** Written over by hand: `text` is no longer `value`. */
  edited: boolean;
}

/**
 * The filled value at `pos` — the inline content right after it, or, with
 * `before`, right before it (a caret at a value's end). The whole value: its
 * pieces run on through line breaks and formatting changes, as long as they
 * carry the same fill.
 */
export function filledMergeTagAt(
  doc: Node,
  pos: number,
  options: { before?: boolean } = {},
): FilledMergeTagRange | null {
  const type = doc.type.schema.marks['filledMergeTag'];
  if (!type) return null;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;
  const offset = $pos.parentOffset;
  let hit = parent.childAfter(offset);
  let mark = hit.node && type.isInSet(hit.node.marks);
  if (!mark && options.before && offset > 0) {
    hit = parent.childBefore(offset);
    mark = hit.node && type.isInSet(hit.node.marks);
  }
  if (!mark) return null;
  const id = mark.attrs['id'] as string;
  const same = (index: number) =>
    index >= 0 && index < parent.childCount && type.isInSet(parent.child(index).marks)?.attrs['id'] === id;
  /** How many children on from `index` (by `step`) still belong to the
      value: one of the fill's, or a line break between two of them. */
  const reach = (index: number, step: 1 | -1) => {
    if (same(index + step)) return 1;
    const between = index + step;
    const leaf = between >= 0 && between < parent.childCount && parent.child(between);
    return leaf && leaf.isLeaf && !leaf.isText && same(between + step) ? 2 : 0;
  };

  let first = hit.index;
  let start = hit.offset;
  for (let n; (n = reach(first, -1)); ) {
    for (let i = 0; i < n; i++) start -= parent.child(--first).nodeSize;
  }
  let last = hit.index;
  let end = hit.offset + parent.child(last).nodeSize;
  for (let n; (n = reach(last, 1)); ) {
    for (let i = 0; i < n; i++) end += parent.child(++last).nodeSize;
  }

  const base = $pos.start();
  const from = base + start;
  const to = base + end;
  const value = mark.attrs['value'] as string;
  const text = doc.textBetween(from, to, '\n', '\n');
  return { from, to, id, expr: mark.attrs['expr'] as string, value, text, edited: text !== value };
}

/** The marks of a value's first text — its formatting, and the fill. */
function valueMarks(doc: Node, from: number, to: number): readonly Mark[] {
  let marks: readonly Mark[] = [];
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && !marks.length) marks = node.marks;
    return !marks.length;
  });
  return marks;
}

/**
 * Writes `text` over the filled value at `pos` (default: the caret's) by
 * hand — and it stays the token's value: the same fill, the formatting of
 * its first piece, a line break in `text` a hard break. One step, undone
 * with Mod-Z. An empty `text` is refused: the value would be gone, and
 * where it came from with it (Restore, or delete it as text).
 */
export const editFilledValue =
  (text: string, pos?: number): Command =>
  (state, dispatch) => {
    const filled = filledMergeTagAt(state.doc, pos ?? state.selection.from, { before: pos === undefined });
    const next = text.replace(/\r\n?/g, '\n');
    if (!filled || !next) return false;
    if (dispatch && next !== filled.text) {
      const content = valueContent(state.schema, next, valueMarks(state.doc, filled.from, filled.to));
      dispatch(state.tr.replaceWith(filled.from, filled.to, content).scrollIntoView());
    }
    return true;
  };

/** Takes back the value as filled in, over whatever was written by hand
    ({@link editFilledValue}); false when the value is not edited. */
export const resetFilledValue =
  (pos?: number): Command =>
  (state, dispatch) => {
    const filled = filledMergeTagAt(state.doc, pos ?? state.selection.from, { before: pos === undefined });
    if (!filled?.edited || !filled.value) return false;
    return editFilledValue(filled.value, filled.from)(state, dispatch);
  };

/**
 * Puts the token back in place of the filled value at `pos` (default: the
 * caret's) — `{{ expr }}` with the value's formatting, a pill again. One
 * step, undone with Mod-Z. Text written into the value since goes with it:
 * the token is what was asked for.
 */
export const restoreMergeTag =
  (pos?: number): Command =>
  (state, dispatch) => {
    const filled = filledMergeTagAt(state.doc, pos ?? state.selection.from, { before: pos === undefined });
    if (!filled) return false;
    if (dispatch) {
      const type = state.schema.marks['filledMergeTag'];
      const marks = type.removeFromSet(valueMarks(state.doc, filled.from, filled.to));
      dispatch(
        state.tr
          .replaceWith(filled.from, filled.to, state.schema.text(`{{ ${filled.expr} }}`, marks))
          .scrollIntoView(),
      );
    }
    return true;
  };

/** A filled value under the pointer while Ctrl is held — what the host's
    card shows. */
export interface FilledMergeTagHover {
  /** The value's piece under the pointer — the card's anchor. */
  element: HTMLElement;
  /** The fill it belongs to. */
  id: string;
  /** Its token's expression, trimmed. */
  expr: string;
  /** The value as filled in, a line break as `\n`. */
  value: string;
  /** The value's text when the pointer came — what an edit field starts
      with. */
  text: string;
  /** Written over by hand. */
  edited: boolean;
  /** Writes `text` over the value by hand, still the token's
      ({@link editFilledValue}); false when the value is gone meanwhile, or
      `text` is empty. */
  edit(text: string): boolean;
  /** Takes back the value as filled in ({@link resetFilledValue}). */
  reset(): boolean;
  /** Puts the token back ({@link restoreMergeTag}); false when the value is
      gone meanwhile. */
  restore(): boolean;
}

/** What became of a request — for the host's message ("3 Platzhalter ohne
    Wert"). */
export interface MergeTagResolutionReport {
  /** Where the request applied. */
  scope: 'selection' | 'document';
  /** How many token occurrences were replaced by a value. */
  filled: number;
  /** Expressions whose value came back empty — a field without a value, or
      one the evaluator could not compute (most say `''` for both). Their
      tokens stay, for the writer to fill by hand or remove. */
  empty: string[];
  /** Expressions the host left unresolved (`null`): their tokens stay. */
  kept: string[];
  /** Expressions the host took out ({@link REMOVE_MERGE_TAG}): their tokens
      are gone, in the fill's own step. */
  removed: string[];
}

/**
 * An evaluator's answer for "this expression stands for nothing here": its
 * tokens are removed in the fill's own transaction — one undo step with the
 * values — and the text closes up behind them, as {@link removeMergeTags}
 * does. For the host that can tell an intent from a gap (`cf_7 ? ', ' +
 * cf_7 : ''` computing to nothing, against a field without a value): `''`
 * stays "no value", and keeps its token.
 */
export const REMOVE_MERGE_TAG: unique symbol = Symbol.for('angular-email-editor.removeMergeTag');

/** What an evaluator says for one expression: the value, the say to take
    its tokens out, or no value (`''`, `null`, `undefined`). */
export type MergeTagAnswer = string | typeof REMOVE_MERGE_TAG | null | undefined;

export interface MergeTagResolutionOptions {
  /**
   * Values for the distinct expressions asked for, in the same order — each
   * the trimmed text between the braces, as written. A string replaces the
   * token; `''`, `null` or `undefined` leave it as it is (`''` is reported
   * as empty — the fill never guesses a removal); {@link REMOVE_MERGE_TAG}
   * takes it out, on the host's word. The editor never evaluates anything
   * itself: this is the host's evaluator.
   *
   * ```ts
   * resolve: async (expressions) => {
   *   const raw = Object.fromEntries(expressions.map((e, i) => [i, `{{${e}}}`]));
   *   const parsed = await textParser.parseStrings(raw, referenceId, {});
   *   return expressions.map((_, i) => parsed[i]);
   * }
   * ```
   */
  resolve: (expressions: string[]) => Promise<readonly MergeTagAnswer[]>;
  /** Called once the values are in the document. */
  onResolved?: (report: MergeTagResolutionReport) => void;
  /** Called when `resolve` rejects — the document is left as it was. */
  onError?: (error: unknown) => void;
  /** Called with `true` when a request goes out and `false` when it is
      settled — the host's spinner. */
  onPendingChange?: (pending: boolean) => void;
  /**
   * Told when the pointer comes onto a filled value while Ctrl is held (the
   * layout guides' peek), and `null` when it leaves — the host's card: the
   * token it was, an edit by hand, and the ways back. A card already up
   * stays while the pointer is on the value, Ctrl released or not, so its
   * buttons can be reached; told again (the same `element`) when the value
   * changes under it.
   */
  onFilledHover?: (hover: FilledMergeTagHover | null) => void;
}

// ---------------------------------------------------------------------------
// Where the tokens are

/** A stretch of the document. */
interface Range {
  from: number;
  to: number;
}

/** One token occurrence: in running text, or in an attribute. */
type Occurrence =
  | { kind: 'text'; from: number; to: number; expr: string }
  | { kind: 'node'; pos: number; attr: string; expr: string }
  | { kind: 'mark'; from: number; to: number; mark: Mark; attr: string; expr: string };

/** The expressions a string holds, trimmed — as the host is asked. */
const expressionsIn = (text: string): string[] =>
  scanMergeTags(text).map((tag) => text.slice(tag.expr[0], tag.expr[1]).trim());

/** The attributes that can hold a token: strings — never the authored
    markup, which is the element as written and follows the modelled
    attributes on its own. */
function tokenAttrs(attrs: Record<string, unknown>): [string, string][] {
  return Object.entries(attrs).filter(
    (entry): entry is [string, string] =>
      entry[0] !== AUTHORED_ATTR && typeof entry[1] === 'string' && entry[1].includes('{{'),
  );
}

/** Every token occurrence touching `[from, to)`, in document order. */
function occurrences(doc: Node, from: number, to: number): Occurrence[] {
  const found: Occurrence[] = [];
  for (const tag of mergeTagRanges(doc)) {
    if (tag.to > from && tag.from < to) {
      found.push({ kind: 'text', from: tag.from, to: tag.to, expr: tag.expr.trim() });
    }
  }
  doc.nodesBetween(from, to, (node, pos) => {
    for (const [attr, value] of tokenAttrs(node.attrs)) {
      for (const expr of expressionsIn(value)) found.push({ kind: 'node', pos, attr, expr });
    }
    if (node.isText) {
      for (const mark of node.marks) {
        for (const [attr, value] of tokenAttrs(mark.attrs)) {
          for (const expr of expressionsIn(value)) {
            found.push({ kind: 'mark', from: pos, to: pos + node.nodeSize, mark, attr, expr });
          }
        }
      }
    }
    return true;
  });
  return found;
}

/** Whether a selection holds a token — then it, not the document, is the
    scope. */
function scopeOf(state: EditorState): { from: number; to: number; selection: boolean } {
  const { from, to, empty } = state.selection;
  if (!empty && occurrences(state.doc, from, to).length) return { from, to, selection: true };
  return { from: 0, to: state.doc.content.size, selection: false };
}

// ---------------------------------------------------------------------------
// Putting values in

/** A string with its tokens replaced where `values` has a string. */
function fillString(text: string, values: Map<string, string | null>): string {
  let out = '';
  let last = 0;
  for (const tag of scanMergeTags(text)) {
    const value = values.get(text.slice(tag.expr[0], tag.expr[1]).trim());
    if (typeof value !== 'string') continue;
    out += text.slice(last, tag.from) + value;
    last = tag.to;
  }
  return out + text.slice(last);
}

/** A value as inline content with `marks`: text, a hard break per line
    break when the schema has one. */
function valueContent(schema: Schema, value: string, marks: readonly Mark[]): Fragment {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const hardBreak = schema.nodes['hardBreak'];
  const nodes: Node[] = [];
  lines.forEach((line, i) => {
    if (i > 0 && hardBreak) nodes.push(hardBreak.create());
    else if (i > 0) line = ` ${line}`;
    if (line) nodes.push(schema.text(line, marks));
  });
  return Fragment.from(nodes);
}

/** A space, as the text has it — typed twice, the editor writes a no-break
    space for one of them. */
const SPACE = /^[ \u00a0]$/;

/** Punctuation that leans on the word before it: a token gone from in front
    of it takes its own leading space along (`Dear {{ title }},` → `Dear,`). */
const CLOSING = /^[,.;:!?)\]]$/;

/** Whether `[from, to)` is running text of spaces only — nothing at all
    included: no node, no line between. */
function onlySpaces(doc: Node, from: number, to: number): boolean {
  const gap = doc.textBetween(from, to);
  return gap.length === to - from && [...gap].every((char) => SPACE.test(char));
}

/**
 * What to delete for `tokens` (in document order) to be gone and the text
 * to read as if they were never there: tokens side by side, or with only
 * spaces between, go as one; and one of the spaces around them goes along
 * (`invite {{ a }} to` → `invite to`) — at a line's start or end, or before
 * a comma or full stop, the space on the other side. In document order,
 * never overlapping.
 */
function removalRanges(doc: Node, tokens: readonly Range[]): Range[] {
  const ranges: Range[] = [];
  for (const token of tokens) {
    const last = ranges.at(-1);
    if (last && onlySpaces(doc, last.to, token.from)) last.to = token.to;
    else ranges.push({ from: token.from, to: token.to });
  }
  for (const range of ranges) {
    const $from = doc.resolve(range.from);
    const $to = doc.resolve(range.to);
    const before = $from.parentOffset > 0 ? doc.textBetween(range.from - 1, range.from) : '';
    const after = $to.parentOffset < $to.parent.content.size ? doc.textBetween(range.to, range.to + 1) : '';
    if (SPACE.test(after) && (SPACE.test(before) || !before)) range.to += 1;
    else if (SPACE.test(before) && (!after || CLOSING.test(after))) range.from -= 1;
  }
  return ranges;
}

/** Applies `values` to every occurrence in `[from, to)`; returns how many
    took a value. An empty value removes its tokens — in an attribute the
    token alone, in running text with the space it leaves closed up
    ({@link removalRanges}). Attributes first (they move nothing), then text
    from the end, so every position read off `doc` still holds when it is
    used. A value written `byHand` is the token's all the same, but nothing
    was filled in: it reads as edited from the start. */
function fill(
  tr: Transaction,
  from: number,
  to: number,
  values: Map<string, string | null>,
  byHand = false,
): number {
  const doc = tr.doc;
  const found = occurrences(doc, from, to).filter(
    (occurrence) => typeof values.get(occurrence.expr) === 'string',
  );

  const nodes = new Set<number>();
  const marks = new Set<string>();
  for (const occurrence of found) {
    if (occurrence.kind === 'node' && !nodes.has(occurrence.pos)) {
      nodes.add(occurrence.pos);
      const node = doc.nodeAt(occurrence.pos)!;
      const attrs = { ...node.attrs };
      for (const [attr, value] of tokenAttrs(node.attrs)) attrs[attr] = fillString(value, values);
      tr.setNodeMarkup(occurrence.pos, undefined, attrs, node.marks);
    }
    if (occurrence.kind === 'mark') {
      const key = `${occurrence.from}:${occurrence.mark.type.name}`;
      if (marks.has(key)) continue;
      marks.add(key);
      const attrs = { ...occurrence.mark.attrs };
      for (const [attr, value] of tokenAttrs(occurrence.mark.attrs)) {
        attrs[attr] = fillString(value, values);
      }
      tr.addMark(occurrence.from, occurrence.to, occurrence.mark.type.create(attrs));
    }
  }

  const mergeTag = doc.type.schema.marks['mergeTag'];
  const filled = doc.type.schema.marks['filledMergeTag'];
  const texts = found.filter((occurrence) => occurrence.kind === 'text');
  const gone = removalRanges(
    doc,
    texts.filter((occurrence) => !values.get(occurrence.expr)),
  ).map((range) => ({ ...range, expr: null }));
  const edits = [...texts.filter((occurrence) => values.get(occurrence.expr)), ...gone];
  for (const occurrence of edits.sort((a, b) => b.from - a.from)) {
    if (occurrence.expr === null) {
      tr.delete(occurrence.from, occurrence.to);
      continue;
    }
    let marks: readonly Mark[] = (tr.doc.nodeAt(occurrence.from)?.marks ?? []).filter(
      (mark) => mark.type !== mergeTag,
    );
    const schema = tr.doc.type.schema;
    let content = valueContent(schema, values.get(occurrence.expr) as string, marks);
    // Where the value came from, when the kit keeps it (FilledMergeTag) —
    // with the value as it went in, read back the way an edit is compared.
    if (filled && content.size) {
      const value = byHand ? '' : content.textBetween(0, content.size, '\n', '\n');
      marks = filled.create({ id: nextFillId(), expr: occurrence.expr, value }).addToSet(marks);
      content = valueContent(schema, values.get(occurrence.expr) as string, marks);
    }
    tr.replaceWith(occurrence.from, occurrence.to, content);
  }
  return found.filter((occurrence) => values.get(occurrence.expr)).length;
}

// ---------------------------------------------------------------------------
// One token, by its expression

/** The distinct expressions the document's tokens hold, trimmed, in the
    order they are first met — running text and attributes alike: what a
    host checks for values before the mail goes out. */
export function distinctMergeTagExpressions(doc: Node): string[] {
  return [...new Set(occurrences(doc, 0, doc.content.size).map((occurrence) => occurrence.expr))];
}

/** The first occurrence of `expr` (trimmed), in document order. */
const firstOccurrence = (doc: Node, expr: string): Occurrence | undefined =>
  occurrences(doc, 0, doc.content.size).find((occurrence) => occurrence.expr === expr.trim());

/**
 * Selects the first token holding `expr` and scrolls it into view: the pill
 * in running text, the node (a button, an image) or the linked text whose
 * attribute holds it. Where a form's "this placeholder has no value" sends
 * the caret. False when no token holds it.
 */
export const selectMergeTag =
  (expr: string): Command =>
  (state, dispatch) => {
    const occurrence = firstOccurrence(state.doc, expr);
    if (!occurrence) return false;
    if (dispatch) {
      const selection =
        occurrence.kind === 'node'
          ? NodeSelection.create(state.doc, occurrence.pos)
          : TextSelection.create(state.doc, occurrence.from, occurrence.to);
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }
    return true;
  };

/**
 * {@link selectMergeTag} in `view`, focused — and the element it stands in
 * (the pill, the node, the link), for a card to open beside. Null when no
 * token holds `expr`.
 */
export function revealMergeTag(view: EditorView, expr: string): HTMLElement | null {
  const occurrence = firstOccurrence(view.state.doc, expr);
  if (!occurrence) return null;
  // Focus first: ProseMirror scrolls to a selection only while the DOM's
  // selection is in the editor — from a Send button, selecting first
  // would leave the token where it was, out of sight.
  view.focus();
  if (!selectMergeTag(expr)(view.state, view.dispatch)) return null;
  if (occurrence.kind === 'node') return view.nodeDOM(occurrence.pos) as HTMLElement | null;
  const { node } = view.domAtPos(occurrence.from + 1);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return (
    element?.closest<HTMLElement>(occurrence.kind === 'text' ? '.aee-merge-tag' : 'a, [href]') ?? element
  );
}

/**
 * Writes `value` by hand in place of every token holding `expr` — in
 * running text with the token's formatting, a line break a hard break, and
 * still the token's ({@link FilledMergeTag}, edited from the start: nothing
 * was filled in); in an attribute, as text. One step, undone with Mod-Z.
 * An empty `value` removes the tokens — {@link removeMergeTag}, the
 * writer's explicit way to an empty value. False when no token holds
 * `expr`.
 */
export const writeMergeTag =
  (expr: string, value: string): Command =>
  (state, dispatch) => {
    const key = expr.trim();
    if (!firstOccurrence(state.doc, key)) return false;
    if (dispatch) {
      const tr = state.tr;
      fill(tr, 0, state.doc.content.size, new Map([[key, value.replace(/\r\n?/g, '\n')]]), true);
      // A selected token (where a send put the caret) would map onto the
      // value as a range — a selection the writer never made: the caret
      // goes after it instead.
      if (!state.selection.empty) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(state.selection.to))));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

/**
 * Removes every token holding one of `expressions` — the say that they
 * stand for nothing here — and closes the text up behind them, so it reads
 * as if they were never there: tokens side by side, or with only spaces
 * between, go as one, and one of the spaces around them goes along (`invite
 * {{ a }} to` → `invite to`; at a line's start or end, or before a comma or
 * full stop, the space on the other side). In an attribute the token alone
 * goes. All of it one step, undone with Mod-Z; the caret stays where it
 * was. False when no token holds any of them.
 */
export const removeMergeTags =
  (expressions: readonly string[]): Command =>
  (state, dispatch) => {
    const keys = expressions.map((expr) => expr.trim());
    if (!keys.some((key) => firstOccurrence(state.doc, key))) return false;
    if (dispatch) {
      const tr = state.tr;
      fill(tr, 0, state.doc.content.size, new Map(keys.map((key) => [key, ''])), true);
      dispatch(tr);
    }
    return true;
  };

/** {@link removeMergeTags} for one expression: every token holding `expr`
    goes, the text closed up behind it. */
export const removeMergeTag = (expr: string): Command => removeMergeTags([expr]);

// ---------------------------------------------------------------------------
// The request

interface Pending {
  id: number;
  from: number;
  to: number;
  selection: boolean;
}

interface ResolutionState {
  pending: Pending | null;
}

type ResolutionMeta = { start: Pending } | { settle: number };

const resolutionKey = new PluginKey<ResolutionState>('mergeTagResolution');

/** Whether a request is out — the action is disabled meanwhile, and a
    host can show it. */
export function mergeTagResolutionPending(state: EditorState): boolean {
  return !!resolutionKey.getState(state)?.pending;
}

let requests = 0;

/**
 * Reports the filled value under the pointer while the peek is on: on the
 * pointer coming onto one, and on the peek coming with the pointer already
 * there. One that is up stays while the pointer is on it, the peek gone or
 * not; it goes when the pointer leaves it, or the value leaves the page.
 * Written over while up (its piece kept on the page), it is reported again:
 * what it reads now, whether it is edited.
 */
function filledHover(
  view: EditorView,
  report: MergeTagResolutionOptions['onFilledHover'],
): { update: (view: EditorView, before: EditorState) => void; destroy: () => void } {
  if (!report) return { update: () => {}, destroy: () => {} };
  /** The value's piece under the pointer, peek or not. */
  let over: HTMLElement | null = null;
  /** The piece reported. */
  let shown: HTMLElement | null = null;

  const sync = () => {
    const next = over && over.isConnected && (isPeeking(view) || over === shown) ? over : null;
    if (next === shown) return;
    shown = next;
    report(next ? hoverOf(view, next) : null);
  };
  const onOver = (event: MouseEvent) => {
    over = (event.target as Element | null)?.closest?.<HTMLElement>('[data-aee-filled]') ?? null;
    if (over && !view.dom.contains(over)) over = null;
    sync();
  };
  const onLeave = () => {
    over = null;
    sync();
  };

  view.dom.addEventListener('mouseover', onOver);
  view.dom.addEventListener('mouseleave', onLeave);
  view.dom.addEventListener(GUIDES_PEEK_EVENT, sync);
  return {
    update: (_, before) => {
      const kept = shown;
      sync();
      if (kept && kept === shown && !before.doc.eq(view.state.doc)) report(hoverOf(view, kept));
    },
    destroy: () => {
      view.dom.removeEventListener('mouseover', onOver);
      view.dom.removeEventListener('mouseleave', onLeave);
      view.dom.removeEventListener(GUIDES_PEEK_EVENT, sync);
      if (shown) report(null);
    },
  };
}

function hoverOf(view: EditorView, element: HTMLElement): FilledMergeTagHover {
  const filled = filledMergeTagAt(view.state.doc, view.posAtDOM(element, 0));
  /** Runs `command` at the value — while its piece is still on the page. */
  const run = (command: (pos: number) => Command) => {
    if (!element.isConnected || view.isDestroyed) return false;
    const done = command(view.posAtDOM(element, 0))(view.state, view.dispatch);
    if (done) view.focus();
    return done;
  };
  return {
    element,
    id: element.getAttribute('data-aee-filled') ?? '',
    expr: element.getAttribute('data-aee-expr') ?? '',
    value: filled?.value ?? '',
    text: filled?.text ?? '',
    edited: !!filled?.edited,
    edit: (text) => run((pos) => editFilledValue(text, pos)),
    reset: () => run(resetFilledValue),
    restore: () => run(restoreMergeTag),
  };
}

/**
 * The placeholder fill: `resolve` asks the host, `onResolved` reports. See
 * the file comment for the contract; the command is `resolveMergeTags`, the
 * action `resolve-placeholders`, the key Mod-Shift-Enter.
 */
export const createMergeTagResolution = (options: MergeTagResolutionOptions): FunctionalExtension => {
  /** Ends request `id` — with the values filled in, when given — unless
      the editor is gone; says whether it did. */
  const settle = (
    view: EditorView,
    id: number,
    fillIn?: (tr: Transaction, pending: Pending) => void,
  ): boolean => {
    if (view.isDestroyed) return false;
    const pending = resolutionKey.getState(view.state)?.pending;
    if (!pending || pending.id !== id) return false;
    const tr = view.state.tr.setMeta(resolutionKey, { settle: id } satisfies ResolutionMeta);
    fillIn?.(tr, pending);
    view.dispatch(tr);
    options.onPendingChange?.(false);
    return true;
  };

  const resolveMergeTags: Command = (state, dispatch, view) => {
    if (mergeTagResolutionPending(state)) return false;
    const scope = scopeOf(state);
    const found = occurrences(state.doc, scope.from, scope.to);
    if (!found.length) return false;
    if (!dispatch || !view) return true;

    const expressions = [...new Set(found.map((occurrence) => occurrence.expr))];
    const id = ++requests;
    dispatch(
      state.tr
        .setMeta(resolutionKey, { start: { id, ...scope } } satisfies ResolutionMeta)
        .setMeta('addToHistory', false),
    );
    options.onPendingChange?.(true);

    options.resolve(expressions).then(
      (answers) => {
        const answered = expressions.map((expr, i) => [expr, answers[i] ?? null] as const);
        // An empty answer is no value: the token stays, for the writer —
        // unless the host says it goes, which `fill` reads as `''`.
        const values = new Map(
          answered.map(([expr, value]) => [expr, value === REMOVE_MERGE_TAG ? '' : value || null]),
        );
        let filled = 0;
        const settled = settle(view, id, (tr, pending) => {
          filled = fill(tr, pending.from, pending.to, values);
          if (filled) tr.scrollIntoView();
        });
        if (!settled) return;
        options.onResolved?.({
          scope: scope.selection ? 'selection' : 'document',
          filled,
          empty: answered.filter(([, value]) => value === '').map(([expr]) => expr),
          kept: answered.filter(([, value]) => value === null).map(([expr]) => expr),
          removed: answered.filter(([, value]) => value === REMOVE_MERGE_TAG).map(([expr]) => expr),
        });
      },
      (error: unknown) => {
        settle(view, id);
        options.onError?.(error);
      },
    );
    return true;
  };

  return defineExtension({
    name: 'mergeTagResolution',
    plugins: () => [
      new Plugin<ResolutionState>({
        key: resolutionKey,
        state: {
          init: () => ({ pending: null }),
          apply: (tr, value) => {
            const meta = tr.getMeta(resolutionKey) as ResolutionMeta | undefined;
            if (meta && 'start' in meta) return { pending: meta.start };
            if (meta && 'settle' in meta) return { pending: null };
            if (!value.pending || !tr.docChanged) return value;
            // The scope follows what is written meanwhile.
            const { pending } = value;
            return {
              pending: {
                ...pending,
                from: tr.mapping.map(pending.from, -1),
                to: tr.mapping.map(pending.to, 1),
              },
            };
          },
        },
        view: (view) => filledHover(view, options.onFilledHover),
      }),
    ],
    keymap: () => ({ 'Mod-Shift-Enter': resolveMergeTags }),
    commands: () => ({
      resolveMergeTags: (): Command => resolveMergeTags,
      restoreMergeTag,
      editFilledValue,
      resetFilledValue,
      selectMergeTag,
      writeMergeTag,
      removeMergeTag,
      removeMergeTags,
    }),
    actions: () => [
      {
        id: 'resolve-placeholders',
        section: 'message',
        title: 'Fill in placeholders',
        keywords: ['placeholders', 'merge tags', 'fill', 'resolve', 'parse', 'variables', 'fields'],
        icon: 'data_object',
        command: resolveMergeTags,
        // Asked on every transaction: a scan, never a request.
        isEnabled: (state) =>
          !mergeTagResolutionPending(state) && occurrences(state.doc, 0, state.doc.content.size).length > 0,
      },
    ],
  });
};
