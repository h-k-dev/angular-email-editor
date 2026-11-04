import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { Mark, MarkType, Node, Schema } from 'prosemirror-model';
import { AddMarkStep, RemoveMarkStep, Transform } from 'prosemirror-transform';
import { defineMark } from '../../extension';
import { expressionDialect } from '../dialects/dialect';
import type { SuggestionTrigger } from '../suggestion-menu';

/**
 * Personalization tokens — `{{cf_70}}`, `{{customer_gender == 'male' ? 'Herr'
 * : 'Frau'}}` — as **text with a mark** (decided 2026-09-02; they were inline
 * atoms before). The raw `{{expression}}` is ordinary document text, braces
 * included, so the cursor lands anywhere inside it, it is edited like any
 * text, and a long expression wraps across lines like text. The `mergeTag`
 * mark only paints the pill, editor-only: the serialized email carries the
 * raw text, stored and re-emitted **verbatim** — the expression is another
 * system's program (an AngularJS-style evaluator, a Handlebars renderer, …)
 * and rewriting so much as its spacing could change what a string literal or
 * date format means. The editor protects; it never interprets.
 *
 * Two invariants, kept by the extension's `appendTransaction` after every
 * change (and by {@link promoteMergeTags} at parse time):
 *
 *  0. **A token is padded canonically**: `{{ expr }}`, one space each side
 *     ({@link canonicalMergeTagInner}) — the only rewrite the editor makes
 *     to a token, applied on parse, on completion, and by the formatter; a
 *     token under the cursor is left alone until the cursor leaves it. An
 *     installed dialect may add its own canonical form of the expression
 *     (`ExpressionDialect.format` — AngularJS: strings in single quotes);
 *     without one, the expression stays byte-verbatim.
 *  1. **The mark covers exactly the tokens.** Text that reads `{{…}}` (per
 *     {@link isMergeTagExpression}) carries the mark, nothing else does —
 *     type a token by hand and it becomes a pill on the closing brace,
 *     delete a brace and the pill is gone. Derived from the text, never
 *     stored: the round trip cannot lie.
 *  2. **Formatting is all-or-nothing on a token.** Bold, italic, colour, a
 *     link: whatever applies to any part of a token applies to the whole of
 *     it — Ctrl-B with the cursor inside bolds the entire `{{…}}`, so the
 *     value it renders to ("Mr Wild") is bold as a whole. A mark added or
 *     removed over part of a token is widened to the token; a token that
 *     arrives partially formatted (a paste, the source pane) is repaired to
 *     whole.
 *
 * What is *not* a token: Handlebars block helpers and partials (`{{#if}}`,
 * `{{/each}}`, `{{>partial}}`) — half of a block is not a value and pairing
 * them is a renderer's job — plus anything nested, multi-line, or past the
 * length ceiling. Those stay plain text.
 */

/** The longest expression the editor protects as one token, in characters
    inside the braces. Real templates run long — a salutation with four
    branches and string concatenation passes 300 — so the ceiling is a
    runaway guard, not a style limit: past it, stray braces around ordinary
    prose stay prose. Measured on the trimmed expression; the scanner and the
    source-pane lint mask allow it plus the two padding spaces (regex
    literals cannot read a constant). */
export const MAX_MERGE_TAG_LENGTH = 1000;

/** A bare dotted identifier — what the registry menu inserts, and the shape
    a field reference takes inside an expression. */
const PATH = /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*$/;

export const isMergeTagPath = (path: string): boolean => PATH.test(path);

/** An inner text the editor will protect as one token: single-line, sanely
    sized, no nested braces, not block syntax (a Handlebars helper / closer /
    `{{else}}` / partial / comment) — half of a block is not a value. */
export function isMergeTagExpression(raw: string): boolean {
  if (/[{}\r\n]/.test(raw)) return false;
  const trimmed = raw.trim();
  if (trimmed.length > MAX_MERGE_TAG_LENGTH) return false;
  return trimmed.length > 0 && trimmed !== 'else' && !/^[#/>!^]/.test(trimmed);
}

/** `{{ … }}` occurrences in running text (capture = the inner expression,
    verbatim). The lookbehind keeps a triple-stash's `{{{` from matching. */
// 1002: the ceiling plus the two canonical padding spaces.
const SCAN = /(?<!\{)\{\{([^{}\r\n]{1,1002})\}\}/g;

/** The canonical padding of a token: `{{ expr }}` — one space each side of
    the trimmed expression. Edge whitespace is insignificant to every dialect
    we transport (AngularJS `$parse`, Handlebars), so this is the one
    rewrite the editor allows itself on a token; the expression itself stays
    byte-verbatim. Handlebars' `{{~ … ~}}` whitespace control and `{{& …}}`
    need their sigil against the braces: those are left as written. */
export function canonicalMergeTagInner(expr: string, format?: (expr: string) => string): string {
  const trimmed = expr.trim();
  if (/^[~&]|~$/.test(trimmed)) return expr;
  return ` ${format ? format(trimmed) : trimmed} `;
}

/** Every token in running text at its canonical padding — the source
    formatter's rule (Shift-Alt-F, Mod-S, format-on-blur), and the same form
    the schema serializes. Pure. */
export function normalizeMergeTagText(text: string, format?: (expr: string) => string): string {
  return text.replace(SCAN, (match, inner: string) =>
    isMergeTagExpression(inner) ? `{{${canonicalMergeTagInner(inner, format)}}}` : match,
  );
}

/** Every token in a piece of running text, as offsets: the whole `{{ … }}`
    and the expression inside it — what a highlighter paints (the source
    pane mutes the braces, Angular-template style). Pure. */
export function scanMergeTags(
  text: string,
  options: { multiline?: boolean } = {},
): { from: number; to: number; expr: [number, number] }[] {
  const found: { from: number; to: number; expr: [number, number] }[] = [];
  // Source text may carry a token the formatter wrapped over several lines
  // (Prettier's interpolation style); the parser collapses those newlines
  // back to spaces, so the token is judged on its collapsed form.
  const scan = options.multiline ? /(?<!\{)\{\{([^{}]{1,1002})\}\}/g : SCAN;
  scan.lastIndex = 0;
  for (let match; (match = scan.exec(text));) {
    if (!isMergeTagExpression(match[1].replace(/\s+/g, ' '))) continue;
    const from = match.index;
    const to = from + match[0].length;
    found.push({ from, to, expr: [from + 2, to - 2] });
  }
  return found;
}

/** A token's place in the document: `[from, to)` around the braces. */
export interface MergeTagRange {
  from: number;
  to: number;
  /** The inner expression, verbatim. */
  expr: string;
}

/** The tokens of one textblock, from its text. A non-text inline node (an
    image, a hard break) counts as a separator: a token never spans one.
    Nor does a change of formatting: `<b>{{ first</b>Name }}` is no token —
    a bold `{{ first` and a plain `Name }}`, text as written; only a token
    one formatting covers whole (`<b>{{ firstName }}</b>`) is a merge tag.
    `pills` (the editor's own edit, a mark put on part of a pill) also
    counts a token the pill mark still covers whole, whatever else it
    carries. */
function textblockTags(textblock: Node, base: number, pills = false): MergeTagRange[] {
  let text = '';
  const runs: { from: number; to: number; marks: readonly Mark[] }[] = [];
  textblock.forEach((child, offset) => {
    text += child.isText ? (child.text ?? '') : '\n'.repeat(child.nodeSize);
    if (child.isText) runs.push({ from: offset, to: offset + child.nodeSize, marks: child.marks });
  });
  /** Whether `[from, to)` is drawn in one formatting (the pill mark aside),
      or — `pills` — is a pill whole. */
  const whole = (from: number, to: number): boolean => {
    const inside = runs.filter((run) => run.from < to && run.to > from);
    const formatting = (marks: readonly Mark[]) =>
      marks.filter((mark) => mark.type.name !== 'mergeTag');
    const first = formatting(inside[0]?.marks ?? []);
    if (inside.every((run) => Mark.sameSet(formatting(run.marks), first))) return true;
    return pills && inside.every((run) => run.marks.some((mark) => mark.type.name === 'mergeTag'));
  };
  const tags: MergeTagRange[] = [];
  SCAN.lastIndex = 0;
  for (let match; (match = SCAN.exec(text));) {
    if (!isMergeTagExpression(match[1])) continue;
    if (!whole(match.index, match.index + match[0].length)) continue;
    tags.push({
      from: base + match.index,
      to: base + match.index + match[0].length,
      expr: match[1],
    });
  }
  return tags;
}

/** Every token in the document, in document order — derived from the text
    and how it is drawn, which are the only truth about them. */
export function mergeTagRanges(doc: Node): MergeTagRange[] {
  return rangesOf(doc, false);
}

function rangesOf(doc: Node, pills: boolean): MergeTagRange[] {
  const tags: MergeTagRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    tags.push(...textblockTags(node, pos + 1, pills));
    return false;
  });
  return tags;
}

/** Every token's raw expression, in document order — for a host that wants
    to evaluate or audit the template as written. */
export function mergeTagExpressions(doc: Node): string[] {
  return mergeTagRanges(doc).map((tag) => tag.expr);
}

/** The token at `pos` — inside it or at either edge — if any. */
export function mergeTagAt(doc: Node, pos: number): MergeTagRange | undefined {
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return undefined;
  return textblockTags($pos.parent, $pos.start()).find((tag) => tag.from <= pos && pos <= tag.to);
}

/** A command inserting the token for `path` at the selection — what a `{{`
    suggestion runs. The token is text; the pill follows from the mark's
    invariants. */
export const insertMergeTag =
  (path: string): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.insertText(`{{ ${path} }}`).scrollIntoView());
    return true;
  };

/** Whether a selection lies within one token — the bubble menu stays away
    then (formatting still works from the keyboard, on the whole token). */
export function selectionInsideMergeTag(state: EditorState): boolean {
  const tag = mergeTagAt(state.doc, state.selection.from);
  return !!tag && state.selection.to <= tag.to;
}

/** Whether the caret stands strictly inside a token — between its braces,
    at neither edge. What a `{{` suggestion menu's `allow` turns down: there
    the braces before the caret open a token that is already written, and
    picking a row would write a second one into it. */
export function caretInsideMergeTag(state: EditorState): boolean {
  const { empty, from } = state.selection;
  const tag = empty ? mergeTagAt(state.doc, from) : undefined;
  return !!tag && tag.from < from && from < tag.to;
}

/** A {@link mergeTagTrigger}: a {@link SuggestionTrigger} whose trigger and
    word rule the preset fixes. */
export interface MergeTagTriggerOptions extends Omit<SuggestionTrigger, 'trigger' | 'startOfWord'> {
  /** What the query may be. Default: a path — one optional space, then
      letters, digits, `_` and `.` (`/^ ?[\w.]*$/`). A host that searches by
      name (spaces, umlauts, punctuation) widens it. */
  query?: RegExp;
  /** The host's own veto — asked only where the caret is not inside a token
      already; both must say yes. */
  allow?: SuggestionTrigger['allow'];
}

/**
 * The `{{` trigger of a suggestion menu, with what makes it correct built in:
 * it opens right after any character (`Hi{{`), its query is a path unless
 * the host widens it, it stays shut for a caret inside a token already
 * written — the braces there are the token's, and a pick would write a
 * second token into the first. A group (a field group) is held by the menu
 * like every menu's — its name drawn after the braces, never written — so
 * `{{` then searches its fields, and Backspace on that empty search is the
 * first level again. Everything else
 * is the host's:
 *
 *     createSuggestionMenu({ element, onChange, triggers: [
 *       { trigger: '/', items: extensionSuggestions },
 *       mergeTagTrigger({ label: 'Personalization tokens', source: mergeTagSource }),
 *     ] })
 */
export function mergeTagTrigger(options: MergeTagTriggerOptions = {}): SuggestionTrigger {
  const { query = /^ ?[\w.]*$/, allow, ...rest } = options;
  return {
    ...rest,
    trigger: '{{',
    startOfWord: false,
    query,
    allow: (props) => !caretInsideMergeTag(props.state) && (allow?.(props) ?? true),
  };
}

// ---------------------------------------------------------------------------
// The invariants

/** Does every text node across `[from, to)` carry `mark`? */
function wholeRangeHasMark(doc: Node, from: number, to: number, mark: Mark): boolean {
  let whole = true;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && !mark.isInSet(node.marks)) whole = false;
    return whole;
  });
  return whole;
}

/** Invariant 0: a token's padding is canonical (`{{ expr }}`). The token the
    cursor is *inside* is left alone while it is being edited — the padding
    would fight the typist — and fixed the moment the cursor leaves it, or on
    the next parse. Replacements run last-to-first so earlier positions hold. */
function padTokens(tr: Transform, cursor?: number, format?: (expr: string) => string): boolean {
  let changed = false;
  const tags = mergeTagRanges(tr.doc);
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    if (cursor !== undefined && cursor > tag.from && cursor < tag.to) continue;
    const canonical = canonicalMergeTagInner(tag.expr, format);
    if (canonical === tag.expr) continue;
    const marks = tr.doc.resolve(tag.from + 2).nodeAfter?.marks ?? [];
    tr.replaceWith(tag.from + 2, tag.to - 2, tr.doc.type.schema.text(canonical, marks));
    changed = true;
  }
  return changed;
}

/** Invariant 1: the `mergeTag` mark covers exactly the tokens. Compares
    per character, so two adjacent tokens (one merged text node) never read
    as a difference. */
function coverTokens(tr: Transform, type: MarkType): boolean {
  let changed = false;
  const doc = tr.doc;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const base = pos + 1;
    const wanted = new Uint8Array(node.content.size);
    for (const tag of textblockTags(node, base)) wanted.fill(1, tag.from - base, tag.to - base);
    const have = new Uint8Array(node.content.size);
    node.forEach((child, offset) => {
      if (child.isText && type.isInSet(child.marks)) have.fill(1, offset, offset + child.nodeSize);
    });
    if (wanted.every((value, i) => value === have[i])) return false;
    tr.removeMark(base, base + node.content.size, type);
    for (const tag of textblockTags(node, base)) tr.addMark(tag.from, tag.to, type.create());
    changed = true;
    return false;
  });
  return changed;
}

/** Invariant 2a: a mark added or removed over *part* of a pill by a
    transaction's steps is widened to the whole pill — an edit in the
    editor, never a parse: a token stored split is no pill (textblockTags). */
function widenMarkSteps(tr: Transform, applied: Transaction, later: Transaction[]): boolean {
  let changed = false;
  let tags: MergeTagRange[] | null = null;
  applied.steps.forEach((step, i) => {
    if (!(step instanceof AddMarkStep) && !(step instanceof RemoveMarkStep)) return;
    const mapping = applied.mapping.slice(i + 1);
    let from = mapping.map(step.from, 1);
    let to = mapping.map(step.to, -1);
    for (const next of later) {
      from = next.mapping.map(from, 1);
      to = next.mapping.map(to, -1);
    }
    // …and through what this repair already did (the padding moves text).
    from = tr.mapping.map(from, 1);
    to = tr.mapping.map(to, -1);
    // The pills as they stood: a mark just put on part of one has split its
    // formatting, and it is still the pill the author meant to format.
    tags ??= rangesOf(tr.doc, true);
    for (const tag of tags) {
      if (tag.from >= to || tag.to <= from) continue;
      if (step instanceof AddMarkStep) {
        if (wholeRangeHasMark(tr.doc, tag.from, tag.to, step.mark)) continue;
        tr.addMark(tag.from, tag.to, step.mark);
      } else {
        if (!tr.doc.rangeHasMark(tag.from, tag.to, step.mark.type)) continue;
        tr.removeMark(tag.from, tag.to, step.mark.type);
      }
      changed = true;
    }
  });
  return changed;
}

/** Invariant 2c: a mark toggled with the cursor *inside* a token (no
    selection — ProseMirror would only set stored marks for the next typed
    character) applies to the whole token instead. */
function applyStoredMarksToToken(
  tr: Transaction,
  state: EditorState,
  applied: Transaction,
): boolean {
  if (!applied.storedMarksSet || !state.selection.empty) return false;
  const tag = mergeTagAt(state.doc, state.selection.from);
  if (!tag || state.selection.from === tag.from || state.selection.from === tag.to) return false;
  const stored = state.storedMarks;
  if (!stored) return false;
  const current = state.doc.resolve(state.selection.from).marks();
  let changed = false;
  for (const mark of stored) {
    if (mark.isInSet(current)) continue;
    tr.addMark(tag.from, tag.to, mark);
    changed = true;
  }
  for (const mark of current) {
    if (mark.isInSet(stored) || mark.type.name === 'mergeTag') continue;
    tr.removeMark(tag.from, tag.to, mark.type);
    changed = true;
  }
  if (changed) tr.setStoredMarks(null);
  return changed;
}

/**
 * Reads the tokens of a parsed document as pills — run by `parseHTML` right
 * after the tables. A token one formatting covers whole becomes a pill, its
 * padding the canonical `{{ expr }}` (the email carries the same text); one
 * split by formatting stays the text it is, never widened to whole. A schema
 * without the mark (the HTML source editor) passes straight through.
 */
export function promoteMergeTags(doc: Node, schema: Schema, format?: (expr: string) => string): Node {
  const type = schema.marks['mergeTag'];
  if (!type) return doc;
  const tr = new Transform(doc);
  padTokens(tr, undefined, format);
  coverTokens(tr, type);
  return tr.doc;
}

export const MergeTag = defineMark({
  name: 'mergeTag',
  spec: {
    // Typing right after `}}` continues as plain text; inside, as token text.
    inclusive: false,
    // The clipboard carries `toDOM`; this rule reads it back. The text alone
    // would re-mark on paste anyway (invariant 1) — the rule just keeps the
    // pill through the round trip without a repair step.
    parseDOM: [{ tag: 'span[data-aee-merge-tag]' }],
    toDOM: () => ['span', { class: 'aee-merge-tag', 'data-aee-merge-tag': '' }, 0],
    // The email carries the raw token text — no editor chrome leaves the app.
    emitDOM: null,
  },
  commands: () => ({
    /** Inserts a field token at the selection — the `{{` menu calls this.
        Fields only: free-form expressions are typed or imported, never built
        by an API that could smuggle syntax past the validation. The mark
        follows from the text (invariant 1). */
    insertMergeTag:
      (path: string): Command =>
      (state, dispatch) => {
        if (!isMergeTagPath(path)) return false;
        dispatch?.(state.tr.insertText(`{{ ${path} }}`).scrollIntoView());
        return true;
      },
  }),
  plugins: ({ schema }) => [
    new Plugin({
      key: new PluginKey('mergeTags'),
      appendTransaction: (transactions, _old, state) => {
        const type = schema.marks['mergeTag'];
        if (!type) return null;
        const tr = state.tr;
        let changed = false;
        transactions.forEach((applied) => {
          changed = applyStoredMarksToToken(tr, state, applied) || changed;
        });
        if (transactions.some((applied) => applied.docChanged)) {
          // Widened first: a pill just formatted in part is still a pill.
          transactions.forEach((applied, i) => {
            changed = widenMarkSteps(tr, applied, transactions.slice(i + 1)) || changed;
          });
          // The installed dialect's canonical form too, when it has one.
          changed = padTokens(tr, state.selection.head, expressionDialect(state)?.format) || changed;
          changed = coverTokens(tr, type) || changed;
        }
        return changed ? tr : null;
      },
    }),
  ],
});

/**
 * The *required fields* of the document: every identifier the token
 * expressions read that the host must supply a value for, deduplicated, in
 * first-use order. This is a lex over the tokens' expressions, not a text
 * parse of the HTML — and it understands enough expression grammar to
 * exclude what is not a field:
 *
 *  - string literals (`'Herr'`, `"+5 days"`),
 *  - filter names (`x | formatPrice` — the identifier after a single `|`),
 *  - function calls (`round(…)`, `parseFloat(…)`),
 *  - dotted tails (`customer.name` needs `customer`, not `name`),
 *  - locals assigned inside any token (`mwst = …; mwst` — `mwst` is
 *    computed, not fetched; the assignment is seen document-wide),
 *  - literals and builtins (`true`, `null`, `now`, …).
 *
 * `{{ mwst = round(parseFloat(cf_70) * 0.19, 2); mwst }}` therefore requires
 * exactly `cf_70`.
 */
export function mergeTagFields(doc: Node): string[] {
  const stripped = mergeTagExpressions(doc).map(blankStrings);

  // Pass 1: locals — an identifier assigned anywhere is computed everywhere.
  const assigned = new Set<string>();
  for (const expr of stripped) {
    forEachIdentifier(expr, (name, context) => {
      if (context.isAssignment) assigned.add(name);
    });
  }

  const fields: string[] = [];
  const seen = new Set<string>();
  for (const expr of stripped) {
    forEachIdentifier(expr, (name, context) => {
      if (context.isFilter || context.isCall || context.isDottedTail || context.isAssignment)
        return;
      if (RESERVED.has(name) || assigned.has(name) || seen.has(name)) return;
      seen.add(name);
      fields.push(name);
    });
  }
  return fields;
}

/** Literals and ambient values an evaluator provides — never fetched. */
const RESERVED = new Set(['true', 'false', 'null', 'undefined', 'this', 'now']);

/** Replaces string literals with spaces of the same length, so identifier
    positions survive and quoted text can never look like a field. */
function blankStrings(expr: string): string {
  return expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, (match) => ' '.repeat(match.length));
}

interface IdentifierContext {
  /** Named directly after a single `|` — a filter, not a value. */
  isFilter: boolean;
  /** Followed by `(` — a function, not a value. */
  isCall: boolean;
  /** Preceded by `.` — a property tail; the dotted root is the field. */
  isDottedTail: boolean;
  /** Followed by a lone `=` — the target of a local assignment. */
  isAssignment: boolean;
}

function forEachIdentifier(
  expr: string,
  visit: (name: string, context: IdentifierContext) => void,
): void {
  for (const match of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const start = match.index;
    const before = expr.slice(0, start).replace(/\s+$/, '');
    const after = expr.slice(start + match[0].length).replace(/^\s+/, '');
    visit(match[0], {
      // A single `|` is the filter pipe; `||` is boolean-or, whose operand
      // is still a value.
      isFilter: before.endsWith('|') && !before.endsWith('||'),
      isCall: after.startsWith('('),
      isDottedTail: before.endsWith('.'),
      isAssignment: after.startsWith('=') && !after.startsWith('=='),
    });
  }
}

// ---------------------------------------------------------------------------
// Tokens in HTML

/** Any tag at all: a token holding one is markup, never a token. */
const MARKUP = /<[A-Za-z/!?]/;

/** The named references a token's text holds: what a serializer writes, and
    what an older editor left. */
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** HTML's entities in a token's text, decoded — by hand, bounded: no
    document needed (a worker has none), no run a hostile input could walk. */
export function decodeMergeTagEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,31});/gi, (reference, name: string) => {
    if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? reference;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : reference;
  });
}

/**
 * HTML with every token written as typed: inside a token, `&amp;`, `&lt;`
 * and `&gt;` back to `&`, `<` and `>` — each only where HTML still reads it
 * as text: `&` not before what could make a character reference, `<` not
 * before what would open a tag. An expression reaches its evaluator as its
 * author wrote it (`cf_3 > 0 && cf_4`, never `&amp;&amp;`), and the HTML
 * reads the same. A `&quot;` stays: in an attribute, it is what keeps it
 * whole. A token holding markup is left as it is. The serializer's and the
 * formatter's last step.
 */
export function writeMergeTags(html: string): string {
  SCAN.lastIndex = 0;
  return html.replace(SCAN, (token, inner: string) => {
    if (MARKUP.test(inner) || !isMergeTagExpression(decodeMergeTagEntities(inner))) return token;
    const typed = inner
      .replace(/&amp;(?![A-Za-z0-9#])/g, '&')
      .replace(/&lt;(?![A-Za-z/!?])/g, '<')
      .replace(/&gt;/g, '>');
    return `{{${typed}}}`;
  });
}

/**
 * A token while HTML is parsed: one word of private-use characters — no
 * quote, brace or space in it, as wide as the token, carrying its index —
 * so a token is never split by the quotes it holds: an attribute's
 * `style="{{ a ? "" : "display:none" }}"` stays whole, as a renderer reads
 * it from the raw text. Put back into the parsed tree
 * ({@link restoreMergeTagsIn}), its quotes are the attribute's text. A
 * token holding markup is never stood in (whatever reads the HTML must see
 * it), and HTML already holding these characters (real content never does)
 * is read as it is — a look-alike must never come back as a token.
 */
const STAND_IN = { open: '\ue000', fill: '\ue001', close: '\ue002', digit0: 0xe010 };
const STAND_INS = /\ue000([\ue010-\ue019]+)\ue001*\ue002/g;

/** HTML with its tokens stood in for, and the tokens by index. */
export function standInMergeTags(html: string): { html: string; tags: readonly string[] } {
  if (/[\ue000-\ue019]/.test(html)) return { html, tags: [] };
  const tags: string[] = [];
  let out = '';
  let at = 0;
  SCAN.lastIndex = 0;
  for (let match = SCAN.exec(html); match; match = SCAN.exec(html)) {
    const [token, inner] = match;
    if (MARKUP.test(inner) || !isMergeTagExpression(decodeMergeTagEntities(inner))) continue;
    const from = match.index;
    const digits = [...String(tags.length)].map((d) => String.fromCharCode(STAND_IN.digit0 + Number(d))).join('');
    tags.push(token);
    out +=
      html.slice(at, from) +
      STAND_IN.open +
      digits +
      STAND_IN.fill.repeat(Math.max(0, token.length - 2 - digits.length)) +
      STAND_IN.close;
    at = from + token.length;
  }
  return { html: out + html.slice(at), tags };
}

/** The tokens back in a parsed tree — its text, comments and attributes —
    each as read: its entities decoded (a tree holds text, not source). */
export function restoreMergeTagsIn(root: globalThis.Node, tags: readonly string[]): void {
  if (!tags.length) return;
  const decoded = tags.map(decodeMergeTagEntities);
  const restore = (text: string) =>
    text.replace(STAND_INS, (_, digits: string) => {
      const index = Number([...digits].map((d) => d.charCodeAt(0) - STAND_IN.digit0).join(''));
      return decoded[index] ?? '';
    });
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
  );
  for (let node: globalThis.Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 3 || node.nodeType === 8) {
      if (node.nodeValue?.includes(STAND_IN.open)) node.nodeValue = restore(node.nodeValue);
    } else {
      for (const attribute of Array.from((node as Element).attributes ?? [])) {
        if (attribute.value.includes(STAND_IN.open)) attribute.value = restore(attribute.value);
      }
    }
  }
}
