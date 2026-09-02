import { Command, Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, Node, Schema, Slice } from 'prosemirror-model';
import { InputRule } from 'prosemirror-inputrules';
import { defineNode } from '../../extension';

/**
 * Personalization tokens — `{{cf_70}}`, `{{customer_gender == 'male' ? 'Herr'
 * : 'Frau'}}` — as first-class inline atoms. In the editor a token is a pill:
 * one unit to select, delete and drag, so a user can never bold half of it,
 * split a ternary with a line break, or let autocorrect eat a brace. In the
 * serialized email it is the raw `{{expression}}` text, stored and re-emitted
 * **verbatim**: the expression is another system's program (an AngularJS-style
 * evaluator, a Handlebars renderer, …) and rewriting so much as its spacing
 * could change what a string literal or date format means. The editor
 * protects; it never interprets.
 *
 * Parsing is repair: any `{{…}}` in incoming HTML — the source pane, an
 * import, a paste — promotes back into a pill (see {@link promoteMergeTags}),
 * so serialize → parse → serialize stays a byte-stable fixpoint and the raw
 * syntax remains typeable in the source pane.
 *
 * What does *not* promote: Handlebars block helpers and partials (`{{#if}}`,
 * `{{/each}}`, `{{>partial}}`) — half of a block is not a value and pairing
 * them is a renderer's job — plus anything nested, multi-line, or absurdly
 * long. Those pass through as plain text untouched.
 */

/** A bare dotted identifier — what the registry menu inserts, and the shape
    a field reference takes inside an expression. */
const PATH = /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*$/;

export const isMergeTagPath = (path: string): boolean => PATH.test(path);

/** An inner text the editor will protect as one token: single-line, sanely
    sized, no nested braces, not block syntax (a Handlebars helper / closer /
    `{{else}}` / partial / comment) — half of a block is not a value. */
export function isMergeTagExpression(raw: string): boolean {
  if (raw.length > 200 || /[{}\r\n]/.test(raw)) return false;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed !== 'else' && !/^[#/>!^]/.test(trimmed);
}

/** `{{ … }}` occurrences in running text (capture = the inner expression,
    verbatim). The lookbehind keeps a triple-stash's `{{{` from matching. */
const SCAN = /(?<!\{)\{\{([^{}\r\n]{1,200})\}\}/g;

export const MergeTag = defineNode({
  name: 'mergeTag',
  spec: {
    inline: true,
    group: 'inline',
    atom: true,
    // Marks apply to the whole token (a bold pill serializes as
    // `<b>{{…}}</b>`), which round-trips: promotion keeps the text's marks.
    attrs: { expr: {} },
    // The pill shows the trimmed expression — the braces are transport
    // syntax. The data attribute makes copy/paste within the editor lossless
    // (the clipboard carries `toDOM`, and this parse rule reads it).
    parseDOM: [
      {
        tag: 'span[data-aee-merge-tag]',
        getAttrs: (dom) => {
          const expr = (dom as HTMLElement).getAttribute('data-aee-merge-tag') ?? '';
          return isMergeTagExpression(expr) ? { expr } : false;
        },
      },
    ],
    toDOM: (node) => {
      const expr = node.attrs['expr'] as string;
      return [
        'span',
        {
          class: isMergeTagPath(expr.trim())
            ? 'aee-merge-tag'
            : 'aee-merge-tag aee-merge-tag--expr',
          'data-aee-merge-tag': expr,
        },
        expr.trim(),
      ];
    },
    // The email carries the raw token text — no editor chrome leaves the app.
    emitDOM: (node: { attrs: Record<string, any> }) => `{{${node.attrs['expr']}}}`,
    // Text projections (word counts, `textBetween`, the editor's `getText`)
    // see the same raw token the email will.
    leafText: (node) => `{{${node.attrs['expr']}}}`,
  },
  commands: ({ schema }) => ({
    /** Inserts a field token at the selection — the `{{` menu calls this.
        Fields only: free-form expressions are typed or imported, never built
        by an API that could smuggle syntax past the validation. */
    insertMergeTag:
      (path: string): Command =>
      (state, dispatch) => {
        if (!isMergeTagPath(path)) return false;
        const node = schema.nodes['mergeTag'].create({ expr: path });
        dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView());
        return true;
      },
  }),
  // Typing the raw syntax promotes on the closing brace — the keyboard-only
  // path to a pill, no menu required.
  inputRules: ({ schema }) => [
    new InputRule(/(?<!\{)\{\{([^{}\r\n]{1,200})\}\}$/, (state, match, start, end) =>
      isMergeTagExpression(match[1])
        ? state.tr.replaceWith(start, end, schema.nodes['mergeTag'].create({ expr: match[1] }))
        : null,
    ),
  ],
  // Pasted text promotes too — the same repair the parser applies, so a token
  // arrives as a pill no matter which door it came through.
  plugins: ({ schema }) => [
    new Plugin({
      key: new PluginKey('mergeTagPaste'),
      props: {
        transformPasted: (slice) =>
          new Slice(promoteInFragment(slice.content, schema), slice.openStart, slice.openEnd),
      },
    }),
  ],
});

/**
 * Promotes every `{{…}}` in the document's text into a `mergeTag` node —
 * the token half of "parsing is repair", applied by `parseHTML` right after
 * the table repair. A schema without the node (the HTML source editor) passes
 * straight through.
 */
export function promoteMergeTags(doc: Node, schema: Schema): Node {
  if (!schema.nodes['mergeTag']) return doc;
  return doc.copy(promoteInFragment(doc.content, schema));
}

function promoteInFragment(fragment: Fragment, schema: Schema): Fragment {
  const type = schema.nodes['mergeTag'];
  if (!type) return fragment;

  const out: Node[] = [];
  fragment.forEach((child) => {
    const text = child.isText ? (child.text ?? '') : '';
    if (text.includes('{{')) {
      let last = 0;
      let matched = false;
      SCAN.lastIndex = 0;
      for (let match; (match = SCAN.exec(text));) {
        if (!isMergeTagExpression(match[1])) continue;
        matched = true;
        if (match.index > last) out.push(schema.text(text.slice(last, match.index), child.marks));
        out.push(type.create({ expr: match[1] }, null, child.marks));
        last = match.index + match[0].length;
      }
      if (!matched) {
        out.push(child); // `{{` without a protectable token — leave the text alone
      } else if (last < text.length) {
        out.push(schema.text(text.slice(last), child.marks));
      }
    } else if (child.content.size) {
      out.push(child.copy(promoteInFragment(child.content, schema)));
    } else {
      out.push(child);
    }
  });
  return Fragment.fromArray(out);
}

/** Every token's raw expression, in document order — for a host that wants
    to evaluate or audit the template as written. */
export function mergeTagExpressions(doc: Node): string[] {
  const exprs: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'mergeTag') exprs.push(node.attrs['expr'] as string);
    return true;
  });
  return exprs;
}

/**
 * The *required fields* of the document: every identifier the token
 * expressions read that the host must supply a value for, deduplicated, in
 * first-use order. The editor knows its tokens as nodes, so this is a lex
 * over their expressions, not a text parse of the HTML — and it understands
 * enough expression grammar to exclude what is not a field:
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
