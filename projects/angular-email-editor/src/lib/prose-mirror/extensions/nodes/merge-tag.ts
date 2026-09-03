import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { Mark, MarkType, Node, Schema } from 'prosemirror-model';
import { AddMarkStep, RemoveMarkStep, Transform } from 'prosemirror-transform';
import { defineMark } from '../../extension';

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
 *     token under the cursor is left alone until the cursor leaves it.
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
export function canonicalMergeTagInner(expr: string): string {
  const trimmed = expr.trim();
  if (/^[~&]|~$/.test(trimmed)) return expr;
  return ` ${trimmed} `;
}

/** Every token in running text at its canonical padding — the source
    formatter's rule (Shift-Alt-F, Mod-S, format-on-blur), and the same form
    the schema serializes. Pure. */
export function normalizeMergeTagText(text: string): string {
  return text.replace(SCAN, (match, inner: string) =>
    isMergeTagExpression(inner) ? `{{${canonicalMergeTagInner(inner)}}}` : match,
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
  for (let match; (match = scan.exec(text)); ) {
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

/** The tokens of one textblock, from its text alone. A non-text inline node
    (an image, a hard break) counts as a separator: a token never spans one. */
function textblockTags(textblock: Node, base: number): MergeTagRange[] {
  let text = '';
  textblock.forEach((child) => {
    text += child.isText ? (child.text ?? '') : '\n'.repeat(child.nodeSize);
  });
  const tags: MergeTagRange[] = [];
  SCAN.lastIndex = 0;
  for (let match; (match = SCAN.exec(text)); ) {
    if (!isMergeTagExpression(match[1])) continue;
    tags.push({ from: base + match.index, to: base + match.index + match[0].length, expr: match[1] });
  }
  return tags;
}

/** Every token in the document, in document order — derived from the text,
    which is the only truth about them. */
export function mergeTagRanges(doc: Node): MergeTagRange[] {
  const tags: MergeTagRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    tags.push(...textblockTags(node, pos + 1));
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

/** Whether a selection lies within one token — the bubble menu stays away
    then (formatting still works from the keyboard, on the whole token). */
export function selectionInsideMergeTag(state: EditorState): boolean {
  const tag = mergeTagAt(state.doc, state.selection.from);
  return !!tag && state.selection.to <= tag.to;
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
function padTokens(tr: Transform, cursor?: number): boolean {
  let changed = false;
  const tags = mergeTagRanges(tr.doc);
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    if (cursor !== undefined && cursor > tag.from && cursor < tag.to) continue;
    const canonical = canonicalMergeTagInner(tag.expr);
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

/** Invariant 2a: a mark added or removed over *part* of a token by a
    transaction's steps is widened to the whole token. */
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
    tags ??= mergeTagRanges(tr.doc);
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

/** Invariant 2b: a token that is partially formatted (a paste, the source
    pane, an import) is repaired to whole — whatever any part of it carries,
    all of it carries. Only ever widens, so it cannot fight a removal. */
function wholeMarksOnTokens(tr: Transform, type: MarkType): boolean {
  let changed = false;
  for (const tag of mergeTagRanges(tr.doc)) {
    const present = new Map<MarkType, Mark>();
    tr.doc.nodesBetween(tag.from, tag.to, (node) => {
      if (node.isText) {
        for (const mark of node.marks) {
          if (mark.type !== type && !present.has(mark.type)) present.set(mark.type, mark);
        }
      }
    });
    for (const mark of present.values()) {
      if (wholeRangeHasMark(tr.doc, tag.from, tag.to, mark)) continue;
      tr.addMark(tag.from, tag.to, mark);
      changed = true;
    }
  }
  return changed;
}

/** Invariant 2c: a mark toggled with the cursor *inside* a token (no
    selection — ProseMirror would only set stored marks for the next typed
    character) applies to the whole token instead. */
function applyStoredMarksToToken(tr: Transaction, state: EditorState, applied: Transaction): boolean {
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
 * Applies both invariants to a parsed document — the token half of "parsing
 * is repair", run by `parseHTML` right after the table repair. A schema
 * without the mark (the HTML source editor) passes straight through.
 */
export function promoteMergeTags(doc: Node, schema: Schema): Node {
  const type = schema.marks['mergeTag'];
  if (!type) return doc;
  const tr = new Transform(doc);
  padTokens(tr);
  coverTokens(tr, type);
  wholeMarksOnTokens(tr, type);
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
          changed = padTokens(tr, state.selection.head) || changed;
          changed = coverTokens(tr, type) || changed;
          transactions.forEach((applied, i) => {
            changed = widenMarkSteps(tr, applied, transactions.slice(i + 1)) || changed;
          });
          changed = wholeMarksOnTokens(tr, type) || changed;
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
