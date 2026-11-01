import {
  Command,
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from 'prosemirror-state';
import { Fragment, Node, Slice } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';
import {
  FunctionalExtension,
  defineExtension,
  createOffsetMapper,
  docText,
} from '@h-k-dev/angular-email-editor';

export interface SourceSearchQuery {
  text: string;
  caseSensitive?: boolean;
  /** `text` is a regular expression; `$1` in a replacement is its group. */
  regexp?: boolean;
  wholeWord?: boolean;
}

/** What a host's search bar draws: handed to `onChange` whenever it moves. */
export interface SourceSearchState {
  open: boolean;
  /** Whether the bar shows its replace row (Mod-H opened it). */
  replace: boolean;
  query: SourceSearchQuery;
  /** Matches in the whole text — folded lines included. */
  count: number;
  /** The selected match's index, -1 while the selection is on none. */
  current: number;
  /** The regular expression does not compile: its message. */
  error: string | null;
}

export interface SourceSearchOptions {
  /** Every change of what the search bar shows. */
  onChange?: (state: SourceSearchState) => void;
  /** Mod-F or Mod-H (or `openSearch`) asked for the bar — also while it is
      open, so the host can put focus in its field again; `replace` when
      the replace field should take it. */
  onOpen?: (replace: boolean) => void;
  /** More matches than this are not drawn or counted. Default 10 000. */
  limit?: number;
}

interface Match {
  from: number;
  to: number;
}

interface SearchPluginState {
  open: boolean;
  replace: boolean;
  query: SourceSearchQuery;
  matches: Match[];
  error: string | null;
  decorations: DecorationSet;
}

type SearchMeta = Partial<Pick<SearchPluginState, 'open' | 'replace' | 'query'>>;

const EMPTY_QUERY: SourceSearchQuery = { text: '' };

function compile(query: SourceSearchQuery): RegExp | string | null {
  if (!query.text) return null;
  const source = query.regexp ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(
      query.wholeWord ? `\\b(?:${source})\\b` : source,
      query.caseSensitive ? 'gmu' : 'gimu',
    );
  } catch (error) {
    return (error as Error).message;
  }
}

function findMatches(
  doc: Node,
  query: SourceSearchQuery,
  limit: number,
): { matches: Match[]; error: string | null } {
  const pattern = compile(query);
  if (typeof pattern === 'string') return { matches: [], error: pattern };
  if (!pattern) return { matches: [], error: null };
  const source = docText(doc);
  const toPm = createOffsetMapper(doc);
  const matches: Match[] = [];
  for (let m = pattern.exec(source); m && matches.length < limit; m = pattern.exec(source)) {
    // An empty match would stall the scan and select nothing.
    if (!m[0]) {
      pattern.lastIndex++;
      continue;
    }
    matches.push({ from: toPm(m.index), to: toPm(m.index + m[0].length) });
  }
  return { matches, error: null };
}

function decorate(
  doc: Node,
  matches: Match[],
  selection: { from: number; to: number },
): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map(({ from, to }) =>
      Decoration.inline(from, to, {
        class:
          from === selection.from && to === selection.to
            ? 'aee-search-match aee-search-match--current'
            : 'aee-search-match',
      }),
    ),
  );
}

/** Puts text into the source over a range — a newline in it starts a line. */
function insertSource(tr: Transaction, from: number, to: number, text: string): void {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) {
    if (text) tr.insertText(text, from, to);
    else tr.delete(from, to);
    return;
  }
  const lineType = tr.doc.type.schema.nodes['codeLine'];
  const nodes = lines.map((line) =>
    lineType.create(null, line ? tr.doc.type.schema.text(line) : null),
  );
  tr.replace(from, to, new Slice(Fragment.from(nodes), 1, 1));
}

/**
 * Opt-in search and replace for the source editor — headless: matches are
 * decorated (`aee-search-match`, the selected one `--current`) and the state
 * goes to `onChange`; the bar itself is the host's, which runs the commands
 * (`setSearchQuery`, `findNext`, `replaceNext`, …).
 *
 * Mod-F opens it with the selected text, Mod-H with the replace row, Enter
 * in the host's field is its `findNext`, F3 / Shift-F3 step through, Escape
 * closes. A match among folded lines selected opens its fold.
 */
export const createSourceSearch = (options: SourceSearchOptions = {}): FunctionalExtension => {
  const key = new PluginKey<SearchPluginState>('sourceSearch');
  const limit = options.limit ?? 10_000;
  const get = (state: EditorState) => key.getState(state)!;

  const update =
    (meta: SearchMeta): Command =>
    (state, dispatch) => {
      dispatch?.(state.tr.setMeta(key, meta).setMeta('addToHistory', false));
      return true;
    };

  /** Opens the bar, its query the selection's text when that is one line;
      `replace` shows or hides the replace row, left as it is when omitted. */
  const open =
    (replace?: boolean): Command =>
    (state, dispatch) => {
      if (!dispatch) return true;
      const { from, to } = state.selection;
      const selected = state.doc.textBetween(from, to, '\n');
      const current = get(state);
      const query =
        selected && !selected.includes('\n') ? { ...current.query, text: selected } : current.query;
      const showReplace = replace ?? current.replace;
      update({ open: true, replace: showReplace, query })(state, dispatch);
      options.onOpen?.(!!replace);
      return true;
    };

  const select = (
    state: EditorState,
    match: Match,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    dispatch?.(
      state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView(),
    );
    return true;
  };

  const findNext: Command = (state, dispatch) => {
    const { matches } = get(state);
    if (!matches.length) return false;
    const after = state.selection.empty ? state.selection.from : state.selection.from + 1;
    return select(state, matches.find((m) => m.from >= after) ?? matches[0], dispatch);
  };

  const findPrevious: Command = (state, dispatch) => {
    const { matches } = get(state);
    if (!matches.length) return false;
    const before = state.selection.from;
    const earlier = matches.filter((m) => m.from < before);
    return select(state, earlier.at(-1) ?? matches.at(-1)!, dispatch);
  };

  /** The replacement for one match — `$1` and the like for a regexp. */
  const replacementFor = (state: EditorState, match: Match, replacement: string): string => {
    const { query } = get(state);
    if (!query.regexp) return replacement;
    const pattern = compile(query);
    if (!(pattern instanceof RegExp)) return replacement;
    const text = state.doc.textBetween(match.from, match.to, '\n');
    return text.replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), replacement);
  };

  /** Replaces the selected match and selects the next; selects the first
      match when the selection is on none. */
  const replaceNext =
    (replacement: string): Command =>
    (state, dispatch) => {
      const { matches } = get(state);
      const { from, to } = state.selection;
      const current = matches.find((m) => m.from === from && m.to === to);
      if (!current) return findNext(state, dispatch);
      if (!dispatch) return true;
      const tr = state.tr;
      insertSource(tr, current.from, current.to, replacementFor(state, current, replacement));
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(current.to)));
      dispatch(tr);
      return true;
    };

  const replaceAll =
    (replacement: string): Command =>
    (state, dispatch) => {
      const { matches } = get(state);
      if (!matches.length) return false;
      if (!dispatch) return true;
      const tr = state.tr;
      // Back to front: an earlier replacement never shifts a later match.
      for (const match of [...matches].reverse()) {
        insertSource(tr, match.from, match.to, replacementFor(state, match, replacement));
      }
      dispatch(tr.scrollIntoView());
      return true;
    };

  /** A new query, and its first match from the selection on selected —
      incremental, as typed: `ta` then `tab` stays on the same place. */
  const setQuery =
    (query: SourceSearchQuery): Command =>
    (state, dispatch) => {
      if (!dispatch) return true;
      const tr = state.tr
        .setMeta(key, { query } satisfies SearchMeta)
        .setMeta('addToHistory', false);
      const { from } = state.selection;
      const { matches } = get(state.apply(tr));
      const first = matches.find((m) => m.from >= from) ?? matches[0];
      if (first)
        tr.setSelection(TextSelection.create(tr.doc, first.from, first.to)).scrollIntoView();
      dispatch(tr);
      return true;
    };

  const close: Command = (state, dispatch) => {
    if (!get(state).open) return false;
    return update({ open: false, replace: false })(state, dispatch);
  };

  return defineExtension({
    name: 'sourceSearch',
    commands: () => ({
      openSearch: (replace?: boolean) => open(replace),
      closeSearch: () => close,
      setSearchQuery: (query: SourceSearchQuery) => setQuery(query),
      findNext: () => findNext,
      findPrevious: () => findPrevious,
      replaceNext: (replacement: string) => replaceNext(replacement),
      replaceAll: (replacement: string) => replaceAll(replacement),
    }),
    keymap: () => ({
      'Mod-f': open(),
      'Mod-h': open(true),
      F3: findNext,
      'Shift-F3': findPrevious,
    }),
    plugins: () => [
      new Plugin<SearchPluginState>({
        key,
        state: {
          init: () => ({
            open: false,
            replace: false,
            query: EMPTY_QUERY,
            matches: [],
            error: null,
            decorations: DecorationSet.empty,
          }),
          apply: (tr, value, _old, state) => {
            const meta = tr.getMeta(key) as SearchMeta | undefined;
            if (!meta && !tr.docChanged && !tr.selectionSet) return value;
            const next = { ...value, ...meta };
            if (!next.open)
              return { ...next, matches: [], error: null, decorations: DecorationSet.empty };
            if (meta?.query || meta?.open || tr.docChanged) {
              Object.assign(next, findMatches(state.doc, next.query, limit));
            }
            next.decorations = decorate(state.doc, next.matches, state.selection);
            return next;
          },
        },
        view: () => {
          let last: SourceSearchState | undefined;
          let shown: Match | undefined;
          return {
            update: (view) => {
              const { open, replace, query, matches, error } = get(view.state);
              const { from, to } = view.state.selection;
              const current = matches.findIndex((m) => m.from === from && m.to === to);
              // A match selected from the host's bar: the editor scrolls to
              // its selection only while the browser's is inside it, so
              // with the field focused the match is brought into view here.
              const match = matches[current];
              const moved = match && (match.from !== shown?.from || match.to !== shown?.to);
              if (moved && !view.hasFocus()) {
                view.dom
                  .querySelector('.aee-search-match--current')
                  ?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
              }
              shown = match;
              const next = { open, replace, query, count: matches.length, current, error };
              if (
                last &&
                last.open === open &&
                last.replace === replace &&
                last.query === query &&
                last.count === next.count &&
                last.current === current &&
                last.error === error
              )
                return;
              last = next;
              options.onChange?.(next);
            },
          };
        },
        props: {
          decorations: (state) => get(state).decorations,
          // Escape closes the bar — and only the bar: not the dialog or
          // panel the source stands in, which listens further up.
          handleKeyDown: (view, event) => {
            if (event.key !== 'Escape' || !close(view.state, view.dispatch)) return false;
            event.stopPropagation();
            return true;
          },
        },
      }),
    ],
  });
};
