import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import {
  FunctionalExtension,
  defineExtension,
  VOID_TAGS,
  createOffsetMapper,
  docText,
  textOffsetAt,
} from '@h-k-dev/angular-email-editor';

/** A tag name's span in the source text. */
type Span = [from: number, to: number];

/** The tag whose name the caret is in or touching: `<ta|ble` or `</table|`. */
function tagNameAt(
  source: string,
  offset: number,
): { name: string; span: Span; close: boolean } | null {
  let from = offset;
  while (from > 0 && /[-\w]/.test(source[from - 1])) from--;
  let to = offset;
  while (to < source.length && /[-\w]/.test(source[to])) to++;
  if (to === from) return null;
  const close = source[from - 1] === '/' && source[from - 2] === '<';
  if (!close && source[from - 1] !== '<') return null;
  return { name: source.slice(from, to).toLowerCase(), span: [from, to], close };
}

/**
 * The partner of a tag: the closer an opener's depth comes back to, or the
 * opener a closer's does — counting only tags of the same name, comments
 * skipped. O(distance), asked only while the caret is on a tag name.
 */
export function matchingTag(source: string, offset: number): [Span, Span] | null {
  const tag = tagNameAt(source, offset);
  if (!tag || VOID_TAGS.has(tag.name)) return null;
  const pattern = new RegExp(`<!--[\\s\\S]*?-->|<(/?)(${tag.name})(?=[\\s/>])[^>]*>`, 'gi');

  if (!tag.close) {
    pattern.lastIndex = tag.span[1];
    let depth = 1;
    for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
      if (!m[2] || m[0].endsWith('/>')) continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        const nameFrom = m.index + 2;
        return [tag.span, [nameFrom, nameFrom + m[2].length]];
      }
    }
    return null;
  }

  // Backwards: every same-name tag before the closer, innermost last.
  const before: { open: boolean; from: number; to: number }[] = [];
  const opener = tag.span[0] - 2;
  for (let m = pattern.exec(source); m && m.index < opener; m = pattern.exec(source)) {
    if (!m[2] || m[0].endsWith('/>')) continue;
    const nameFrom = m.index + (m[1] ? 2 : 1);
    before.push({ open: !m[1], from: nameFrom, to: nameFrom + m[2].length });
  }
  let depth = 1;
  for (let i = before.length - 1; i >= 0; i--) {
    depth += before[i].open ? -1 : 1;
    if (depth === 0) return [[before[i].from, before[i].to], tag.span];
  }
  return null;
}

function decorations(state: EditorState): DecorationSet | null {
  const { selection, doc } = state;
  if (!selection.empty || !selection.$head.parent.type.spec['code']) return null;
  // Not a tag name on this line: no need to join the whole text.
  const line = selection.$head.parent.textContent;
  if (!/<\/?[-\w]*$/.test(line.slice(0, selection.$head.parentOffset))) return null;

  const source = docText(doc);
  const pair = matchingTag(source, textOffsetAt(doc, selection.head));
  if (!pair) return null;
  const toPm = createOffsetMapper(doc);
  return DecorationSet.create(
    doc,
    pair.map(([from, to]) => Decoration.inline(toPm(from), toPm(to), { class: 'aee-tag-match' })),
  );
}

/**
 * Opt-in: with the caret on a tag name, that tag's name and its partner's
 * carry `aee-tag-match` — VS Code's matching-tag highlight, so the closer of
 * a 300-line table is found at a glance. Pair it with folding, whose
 * gutter folds the same pairs.
 */
export const createTagMatching = (): FunctionalExtension =>
  defineExtension({
    name: 'tagMatching',
    plugins: () => [
      new Plugin<DecorationSet | null>({
        key: new PluginKey('tagMatching'),
        state: {
          init: (_, state) => decorations(state),
          apply: (tr, value, _old, state) =>
            tr.docChanged || tr.selectionSet ? decorations(state) : value,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ],
  });
