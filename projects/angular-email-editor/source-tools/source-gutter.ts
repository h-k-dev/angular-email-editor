import { Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '@h-k-dev/angular-email-editor';

/** Every line's number, as `data-line` on it. */
function numberLines(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((line, offset, index) => {
    decorations.push(
      Decoration.node(offset, offset + line.nodeSize, { 'data-line': String(index + 1) }),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/** The numbers after a change: mapped while each line keeps its number —
    typing within lines — and numbered afresh once a line came, went or
    moved (a mapped set then misses the lines it lost). */
function renumber(tr: Transaction, numbers: DecorationSet): DecorationSet {
  if (!tr.docChanged) return numbers;
  if (tr.doc.childCount !== tr.before.childCount) return numberLines(tr.doc);
  const mapped = numbers.map(tr.mapping, tr.doc);
  return mapped.find().length === tr.doc.childCount ? mapped : numberLines(tr.doc);
}

/**
 * The source editor's gutter, opt-in: the class `aee-source-gutter` on the
 * editor, `--aee-line-digits` (the widest number's digits) for its width,
 * every line's number as its `data-line` and `aee-code-line--active` on the
 * caret's line — the host's CSS draws them:
 *
 *     .aee-source-gutter > .aee-code-line::before { content: attr(data-line); }
 *
 * Numbers are attributes, not a CSS counter, so a host can give each line
 * `content-visibility: auto` (whose style containment scopes counters):
 * resizing a long source then lays out only the lines on screen. Typing
 * within lines only maps them; a new or removed line renumbers.
 *
 * Not in `htmlSourceExtensions`: a host that wants it adds it to its kit,
 * and one that does not never bundles it.
 */
export const createSourceGutter = (): FunctionalExtension =>
  defineExtension({
    name: 'sourceGutter',
    plugins: () => [
      new Plugin<DecorationSet>({
        key: new PluginKey('sourceGutter'),
        state: {
          init: (_, state) => numberLines(state.doc),
          apply: (tr, numbers) => renumber(tr, numbers),
        },
        props: {
          attributes: (state) => ({
            class: 'aee-source-gutter',
            style: `--aee-line-digits: ${String(state.doc.childCount).length}`,
          }),
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      // The caret's line: a set of its own — one decoration, made per draw.
      new Plugin({
        key: new PluginKey('sourceActiveLine'),
        props: {
          decorations: (state) => {
            const { $head } = state.selection;
            if ($head.depth < 1) return null;
            const from = $head.before(1);
            return DecorationSet.create(state.doc, [
              Decoration.node(from, from + $head.node(1).nodeSize, {
                class: 'aee-code-line--active',
              }),
            ]);
          },
        },
      }),
    ],
  });
