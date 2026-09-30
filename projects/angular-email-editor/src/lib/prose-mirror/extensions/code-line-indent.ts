import { Node } from 'prosemirror-model';
import { Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { defineExtension } from '../extension';

/**
 * Each source line's indentation, as the custom property `--aee-line-indent`
 * (in characters) on its `.aee-code-line` — what a host needs for VS Code's
 * soft wrap: a wrapped line continues under its own indentation, not at the
 * margin (`wrappingIndent: "same"`). The pixels are the host's:
 *
 *     .aee-code-line {
 *       padding-inline-start: calc(var(--aee-line-indent, 0) * 1ch);
 *       text-indent: calc(var(--aee-line-indent, 0) * -1ch);
 *     }
 *
 * The first row starts at the margin (its spaces fill the indent); every row
 * the line wraps into starts where its text does.
 *
 * Decorations, not the line's `toDOM`: a line's element is not re-rendered
 * when its text changes, so an indent typed or deleted would never reach it.
 * An edit rebuilds only the lines it touched — a keystroke in a 3000-line
 * template costs one line.
 */
export const CodeLineIndent = defineExtension({
  name: 'codeLineIndent',
  plugins: () => [
    new Plugin<DecorationSet>({
      key: new PluginKey('codeLineIndent'),
      state: {
        init: (_, state) => DecorationSet.create(state.doc, lineDecorations(state.doc, 0, state.doc.content.size)),
        apply: (tr, set) => (tr.docChanged ? rebuildTouched(tr, set.map(tr.mapping, tr.doc)) : set),
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    }),
  ],
});

/** The indentation decorations of the top-level lines between two positions. */
function lineDecorations(doc: Node, from: number, to: number): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    const indent = /^[ \t]*/.exec(node.textContent)![0].length;
    if (indent) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { style: `--aee-line-indent: ${indent}` }),
      );
    }
    return false; // lines only — never their text
  });
  return decorations;
}

/** Replaces the decorations of every line the transaction changed. */
function rebuildTouched(tr: Transaction, set: DecorationSet): DecorationSet {
  let from = Infinity;
  let to = -Infinity;
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, after.map(newStart, -1));
      to = Math.max(to, after.map(newEnd, 1));
    });
  });
  if (from === Infinity) return set;
  const size = tr.doc.content.size;
  // Widen to whole lines: the one before the change may have been joined.
  from = Math.max(0, Math.min(from, size) - 1);
  to = Math.min(size, to + 1);
  let start = from;
  let end = to;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    start = Math.min(start, pos);
    end = Math.max(end, pos + node.nodeSize);
    return false;
  });
  // `find` also returns what merely touches the range — the neighbours'.
  const stale = set.find(start, end).filter((d) => d.from >= start && d.to <= end);
  return set.remove(stale).add(tr.doc, lineDecorations(tr.doc, start, end));
}
