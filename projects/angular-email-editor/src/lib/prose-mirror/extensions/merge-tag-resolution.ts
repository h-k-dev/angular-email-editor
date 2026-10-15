import { Fragment, Mark, Node, Schema } from 'prosemirror-model';
import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { AUTHORED_ATTR } from '../authored';
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
 * - all of it is **one transaction**: one Mod-Z brings the tokens back.
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

/** What became of a request — for the host's message ("3 Platzhalter ohne
    Wert"). */
export interface MergeTagResolutionReport {
  /** Where the request applied. */
  scope: 'selection' | 'document';
  /** How many token occurrences were replaced by a value. */
  filled: number;
  /** Expressions whose value came back empty — a field without a value, or
      one the evaluator could not compute (most say `''` for both). Their
      tokens are gone. */
  empty: string[];
  /** Expressions the host left unresolved (`null`): their tokens stay. */
  kept: string[];
}

export interface MergeTagResolutionOptions {
  /**
   * Values for the distinct expressions asked for, in the same order — each
   * the trimmed text between the braces, as written. A string replaces the
   * token (`''` removes it); `null` or `undefined` leaves it as it is. The
   * editor never evaluates anything itself: this is the host's evaluator.
   *
   * ```ts
   * resolve: async (expressions) => {
   *   const raw = Object.fromEntries(expressions.map((e, i) => [i, `{{${e}}}`]));
   *   const parsed = await textParser.parseStrings(raw, referenceId, {});
   *   return expressions.map((_, i) => parsed[i]);
   * }
   * ```
   */
  resolve: (expressions: string[]) => Promise<readonly (string | null | undefined)[]>;
  /** Called once the values are in the document. */
  onResolved?: (report: MergeTagResolutionReport) => void;
  /** Called when `resolve` rejects — the document is left as it was. */
  onError?: (error: unknown) => void;
  /** Called with `true` when a request goes out and `false` when it is
      settled — the host's spinner. */
  onPendingChange?: (pending: boolean) => void;
}

// ---------------------------------------------------------------------------
// Where the tokens are

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

/** Applies `values` to every occurrence in `[from, to)`; returns how many
    were filled. Attributes first (they move nothing), then text from the
    end, so every position read off `doc` still holds when it is used. */
function fill(tr: Transaction, from: number, to: number, values: Map<string, string | null>): number {
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
  const texts = found.filter((occurrence) => occurrence.kind === 'text').reverse();
  for (const occurrence of texts) {
    const marks = (tr.doc.nodeAt(occurrence.from)?.marks ?? []).filter((mark) => mark.type !== mergeTag);
    const content = valueContent(tr.doc.type.schema, values.get(occurrence.expr) as string, marks);
    tr.replaceWith(occurrence.from, occurrence.to, content);
  }
  return found.length;
}

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
        const values = new Map(expressions.map((expr, i) => [expr, answers[i] ?? null]));
        let filled = 0;
        const settled = settle(view, id, (tr, pending) => {
          filled = fill(tr, pending.from, pending.to, values);
          if (filled) tr.scrollIntoView();
        });
        if (!settled) return;
        options.onResolved?.({
          scope: scope.selection ? 'selection' : 'document',
          filled,
          empty: expressions.filter((expr) => values.get(expr) === ''),
          kept: expressions.filter((expr) => values.get(expr) === null),
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
      }),
    ],
    keymap: () => ({ 'Mod-Shift-Enter': resolveMergeTags }),
    commands: () => ({ resolveMergeTags: (): Command => resolveMergeTags }),
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
