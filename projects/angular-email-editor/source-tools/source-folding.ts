import {
  Command,
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import {
  FunctionalExtension,
  defineExtension,
  HtmlTag,
  VOID_TAGS,
  scanHTML,
  TYPING_REST,
  docText,
} from '@h-k-dev/angular-email-editor';

/**
 * Where the source can fold, by line index: start line → the line that stays
 * visible after the fold (the closer's). The lines between hide. An element
 * whose tags stand on different lines, a comment over several lines, and a
 * CSS rule's `{ … }` inside `<style>` — the outermost range wins a line.
 */
export function foldRanges(source: string): Map<number, number> {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  const ranges = new Map<number, number>();
  const add = (from: number, to: number) => {
    const start = lineOf(from);
    const end = lineOf(to);
    // At least one line to hide, and the outermost range on a line.
    if (end - start >= 2 && (ranges.get(start) ?? -1) < end) ranges.set(start, end);
  };

  const scan = scanHTML(source);
  for (const token of scan.tokens) if (token.type === 'comment') add(token.from, token.to - 1);

  const open: HtmlTag[] = [];
  for (const tag of scan.tags) {
    if (!tag.terminated) continue;
    if (tag.kind === 'open') {
      if (!VOID_TAGS.has(tag.name) && !tag.selfClosing) open.push(tag);
      continue;
    }
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].name !== tag.name) continue;
      add(open[i].from, tag.from);
      if (tag.name === 'style') {
        const braces: number[] = [];
        for (let j = open[i].to; j < tag.from; j++) {
          if (source[j] === '{') braces.push(j);
          else if (source[j] === '}' && braces.length) add(braces.pop()!, j);
        }
      }
      open.length = i;
      break;
    }
  }
  return ranges;
}

/** A fold, by the positions of its first line's node and of the node of the
    line that stays visible after it. */
interface Fold {
  start: number;
  end: number;
}

interface FoldingState {
  folds: Fold[];
  /** The folds' own decorations: the hidden lines and the `⋯`. */
  folded: DecorationSet;
  /** `aee-code-line--foldable` on every line a fold can start from. */
  foldable: DecorationSet;
  /** Typed into since `foldable` was built: a rescan is due. */
  stale: boolean;
}

type FoldingMeta = { folds: Fold[] } | 'rescan';

/** The node position of every top-level line, by index. */
function linePositions(doc: Node): number[] {
  const positions: number[] = [];
  doc.forEach((_line, offset) => positions.push(offset));
  return positions;
}

function foldableDecorations(doc: Node): DecorationSet {
  const positions = linePositions(doc);
  const decorations: Decoration[] = [];
  for (const start of foldRanges(docText(doc)).keys()) {
    const pos = positions[start];
    decorations.push(
      Decoration.node(pos, pos + doc.child(start).nodeSize, { class: 'aee-code-line--foldable' }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

function placeholder(): HTMLElement {
  const element = document.createElement('span');
  element.className = 'aee-fold-placeholder';
  element.contentEditable = 'false';
  element.title = 'Unfold';
  element.textContent = '⋯';
  return element;
}

function foldedDecorations(doc: Node, folds: Fold[]): DecorationSet {
  const decorations: Decoration[] = [];
  for (const { start, end } of folds) {
    const first = doc.nodeAt(start)!;
    const after = start + first.nodeSize;
    decorations.push(
      Decoration.node(start, after, { class: 'aee-code-line--folded' }),
      Decoration.widget(after - 1, placeholder, {
        side: 1,
        ignoreSelection: true,
        key: `fold-${start}`,
      }),
    );
    doc.nodesBetween(after, end, (node, pos) => {
      if (pos >= after && pos < end) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { class: 'aee-code-line--hidden' }),
        );
      }
      return false;
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** A fold still standing after a change: nothing changed among its hidden
    lines and both its ends still lines. Typing on its first or its last
    line keeps it; anything between opens it. */
function mapFold(fold: Fold, tr: Transaction): Fold | null {
  let { start, end } = fold;
  for (let i = 0; i < tr.steps.length; i++) {
    const map = tr.mapping.maps[i];
    const first = tr.docs[i].nodeAt(start);
    if (!first) return null;
    const hiddenFrom = start + first.nodeSize;
    let touched = false;
    map.forEach((oldStart, oldEnd) => {
      touched ||= oldEnd >= hiddenFrom && oldStart <= end;
    });
    if (touched) return null;
    start = map.map(start, 1);
    end = map.map(end, 1);
  }
  const first = tr.doc.nodeAt(start);
  const last = tr.doc.nodeAt(end);
  if (first?.type.name !== 'codeLine' || last?.type.name !== 'codeLine') return null;
  return start + first.nodeSize < end ? { start, end } : null;
}

/** Whether a position is among a fold's hidden lines. */
function hides(doc: Node, fold: Fold, pos: number): boolean {
  return pos >= fold.start + doc.nodeAt(fold.start)!.nodeSize && pos <= fold.end;
}

/** The range to fold for a line: one starting on it, else the innermost
    holding it. */
function rangeAt(doc: Node, line: number): [number, number] | null {
  const ranges = foldRanges(docText(doc));
  const own = ranges.get(line);
  if (own !== undefined) return [line, own];
  let best: [number, number] | null = null;
  for (const [start, end] of ranges) {
    if (start < line && line <= end && (!best || start > best[0])) best = [start, end];
  }
  return best;
}

/**
 * Opt-in code folding for the source editor, VS Code's: a chevron in the
 * gutter on every line a fold can start from (`aee-code-line--foldable`,
 * the host's CSS draws it — shown on hover, always while folded), a click
 * on it or Mod-Shift-[ / Mod-Shift-] to fold and unfold, `⋯` after a folded
 * line that unfolds on a click. Elements whose tags stand on different lines
 * fold, so do comments and the `{ … }` rules of a `<style>`.
 *
 * Folding is the view's only: hidden lines are `display: none` and the
 * text is untouched — copy, search, send see all of it. A caret or an edit
 * reaching hidden lines opens their fold. The gutter's numbers are each
 * line's own, so they skip what is folded by themselves.
 */
export const createSourceFolding = (): FunctionalExtension => {
  const key = new PluginKey<FoldingState>('sourceFolding');
  const folds = (state: EditorState): Fold[] => key.getState(state)?.folds ?? [];

  const setFolds = (state: EditorState, next: Fold[]): Transaction =>
    state.tr.setMeta(key, { folds: next } satisfies FoldingMeta).setMeta('addToHistory', false);

  /** Folds the range of a line; the caret, if it would hide, onto its first line. */
  const foldLine = (
    state: EditorState,
    line: number,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const range = rangeAt(state.doc, line);
    if (!range) return false;
    if (!dispatch) return true;
    const positions = linePositions(state.doc);
    const fold = { start: positions[range[0]], end: positions[range[1]] };
    const tr = setFolds(state, [...folds(state).filter((f) => f.start !== fold.start), fold]);
    if (hides(state.doc, fold, state.selection.head)) {
      const firstEnd = fold.start + 1 + state.doc.nodeAt(fold.start)!.content.size;
      tr.setSelection(TextSelection.create(tr.doc, firstEnd));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };

  /** Opens the fold starting on a line, or the folds holding it. */
  const unfoldLine = (
    state: EditorState,
    line: number,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const pos = linePositions(state.doc)[line];
    const keep = folds(state).filter((f) => f.start !== pos && !hides(state.doc, f, pos));
    if (keep.length === folds(state).length) return false;
    dispatch?.(setFolds(state, keep));
    return true;
  };

  const fold: Command = (state, dispatch) =>
    foldLine(state, state.selection.$head.index(0), dispatch);
  const unfold: Command = (state, dispatch) =>
    unfoldLine(state, state.selection.$head.index(0), dispatch);
  const unfoldAll: Command = (state, dispatch) => {
    if (!folds(state).length) return false;
    dispatch?.(setFolds(state, []));
    return true;
  };

  /** A click on a gutter chevron or on a `⋯`. */
  const onMouseDown = (view: EditorView, event: MouseEvent): boolean => {
    const target = event.target as HTMLElement;
    const line = target.closest?.('.aee-code-line');
    if (!line || event.button !== 0) return false;
    const onPlaceholder = !!target.closest('.aee-fold-placeholder');
    // Left of where the line's text starts: the gutter, whether the host
    // draws it in the line's own padding or in the editor's.
    const inGutter =
      line.matches('.aee-code-line--foldable, .aee-code-line--folded') &&
      event.clientX < view.coordsAtPos(view.posAtDOM(line, 0)).left;
    if (!onPlaceholder && !inGutter) return false;

    event.preventDefault();
    const index = view.state.doc.resolve(view.posAtDOM(line, 0)).index(0);
    if (!unfoldLine(view.state, index, view.dispatch)) foldLine(view.state, index, view.dispatch);
    return true;
  };

  return defineExtension({
    name: 'sourceFolding',
    commands: () => ({
      fold: () => fold,
      unfold: () => unfold,
      unfoldAll: () => unfoldAll,
    }),
    // VS Code's; Shift turns `[` into `{` on most layouts.
    keymap: () => ({
      'Mod-Shift-[': fold,
      'Mod-Shift-]': unfold,
      'Mod-{': fold,
      'Mod-}': unfold,
    }),
    plugins: () => [
      new Plugin<FoldingState>({
        key,
        state: {
          init: (_, state) => ({
            folds: [],
            folded: DecorationSet.empty,
            foldable: foldableDecorations(state.doc),
            stale: false,
          }),
          apply: (tr, value, _old, state) => {
            const meta = tr.getMeta(key) as FoldingMeta | undefined;
            if (meta === 'rescan') {
              return { ...value, foldable: foldableDecorations(state.doc), stale: false };
            }

            let { folds: next, folded, foldable, stale } = value;
            let changed = false;
            if (tr.docChanged) {
              const mapped = next.map((f) => mapFold(f, tr)).filter((f): f is Fold => !!f);
              changed = mapped.length !== next.length;
              next = mapped;
              if (!changed) folded = folded.map(tr.mapping, tr.doc);
              foldable = foldable.map(tr.mapping, tr.doc);
              stale = true;
            }
            if (meta) {
              next = meta.folds;
              changed = true;
            }
            // The caret among hidden lines opens their fold.
            const head = state.selection.head;
            const open = next.filter((f) => !hides(state.doc, f, head));
            if (open.length !== next.length) {
              next = open;
              changed = true;
            }
            if (changed) folded = foldedDecorations(state.doc, next);
            return { folds: next, folded, foldable, stale };
          },
        },
        // The chevrons are mapped while typing, found again once it rests —
        // the same pacing as the highlighting.
        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return {
            update: (current, prev) => {
              if (current.state.doc === prev.doc || !key.getState(current.state)?.stale) return;
              clearTimeout(timer);
              timer = setTimeout(() => {
                if (view.isDestroyed || !key.getState(view.state)?.stale) return;
                view.dispatch(view.state.tr.setMeta(key, 'rescan').setMeta('addToHistory', false));
              }, TYPING_REST);
            },
            destroy: () => clearTimeout(timer),
          };
        },
        props: {
          decorations: (state) => key.getState(state)?.folded,
          handleDOMEvents: { mousedown: onMouseDown },
        },
      }),
      // The chevrons: a set of their own — a plugin draws only one.
      new Plugin({
        key: new PluginKey('sourceFoldable'),
        props: { decorations: (state) => key.getState(state)?.foldable },
      }),
    ],
  });
};
