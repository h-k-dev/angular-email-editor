import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { Node, ResolvedPos } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';

/**
 * What an empty line is, as the placeholder words it — Notion's blocks that
 * carry words of their own, read from where the line stands:
 * - `'heading'` — a heading, any level.
 * - `'quote'` — a line directly in a blockquote.
 * - `'bulletList'` / `'orderedList'` — a list item's own line (its first).
 * - `'tableCell'` — a table cell.
 * - `'line'` — any other line: a paragraph, a column's, a section's.
 */
export type PlaceholderKind =
  'line' | 'heading' | 'quote' | 'bulletList' | 'orderedList' | 'tableCell';

/** An empty line the placeholder may speak on — what a function-form
    {@link PlaceholderText} is asked with. */
export interface PlaceholderLine {
  /** The empty textblock: a paragraph, a heading, a list item's line. */
  node: Node;
  /** Its position in the document. */
  pos: number;
  /** What it is — see {@link PlaceholderKind}. */
  kind: PlaceholderKind;
  /** Whether it is the whole document's only line — the body is empty. */
  docEmpty: boolean;
  state: EditorState;
}

/**
 * The words by what is empty, Notion's set. A block kind's words show on
 * every empty block of that kind, focused or not — an empty heading still
 * reads as a heading; `line` is the hint under the caret. A kind left out
 * (`undefined`) is a plain line and takes the hint; `''` leaves it bare.
 */
export interface PlaceholderWords {
  /** A plain line under the caret: Notion's "Type '/' for commands". */
  line?: string;
  /** The whole body while it is empty. Default {@link line}. */
  empty?: string;
  /** A heading — one string for every level, or one per level (index 0 is
      level 1; a level past the end takes the last). */
  heading?: string | readonly string[];
  /** A line in a quote: Notion's "Empty quote". */
  quote?: string;
  /** A bulleted list item: Notion's "List". */
  bulletList?: string;
  /** A numbered list item: Notion's "List". */
  orderedList?: string;
  /** A table cell — Notion's cells say nothing, so `''` follows it. */
  tableCell?: string;
  /** An image with no file yet: Notion's "Add an image". The frame keeps
      its own words without it. */
  image?: string;
}

/**
 * The words on an empty line:
 * - a string — the hint under the caret, the same words everywhere: what a
 *   host's template hands in through its translate pipe.
 * - {@link PlaceholderWords} — words by kind, Notion's way. Build it once per
 *   language (a `computed`), never per line.
 * - a function of the line — anything else; asked for each empty line when
 *   it changes. Its words on a block kind show always, on a plain line under
 *   the caret; `null` or `''` leaves the line bare.
 */
export type PlaceholderText =
  string | PlaceholderWords | ((line: PlaceholderLine) => string | null | undefined);

export interface PlaceholderOptions {
  /** The words — see {@link PlaceholderText}. Replaced later with the
      `setPlaceholder` command, which is how a host follows a language
      switch. Default none: the editor shows nothing until it is given words. */
  text?: PlaceholderText;
  /**
   * Which plain empty lines show the hint, while the editor is editable:
   * - `'caret'` (default) — the one the caret is on, while the editor has
   *   focus: Notion's. Moving on hides it.
   * - `'all'` — every empty line, focused or not.
   *
   * A block kind with words of its own shows them either way, and an empty
   * body shows its words on its one line, focused or not: the field says
   * what it is for, as a textarea's placeholder does.
   */
  show?: 'caret' | 'all';
}

interface PlaceholderState {
  text: PlaceholderText | undefined;
  /** What shows without the caret: block kinds, every line under `'all'`,
      an empty body, image frames. Kept across transactions and redone only
      where the document changed — the caret's hint is added per draw. */
  set: DecorationSet;
}

export const placeholderKey = new PluginKey<PlaceholderState>('placeholder');

/** Replaces the placeholder's words — every empty line redraws at once.
    Nothing enters the undo history. */
export const setPlaceholder =
  (text: PlaceholderText | undefined): Command =>
  (state, dispatch) => {
    if (!placeholderKey.get(state)) return false;
    dispatch?.(state.tr.setMeta(placeholderKey, { text }).setMeta('addToHistory', false));
    return true;
  };

const isBare = (node: Node | null | undefined): node is Node =>
  !!node && node.isTextblock && !node.type.spec.code && node.content.size === 0;

/** Whether the document is a single empty line. */
const isDocEmpty = (doc: Node): boolean => doc.childCount === 1 && isBare(doc.firstChild);

/** An image waiting for its file. */
const isEmptyImage = (node: Node): boolean => node.type.name === 'image' && !node.attrs['src'];

/** Containers that give the lines in them a kind: a change inside one may
    re-kind a line it never touched (a line pushed off a list item's head). */
const KIND_CONTAINERS = new Set(['blockquote', 'listItem', 'bulletList', 'orderedList']);

/** What the line at `$pos` (resolved just before it) is. */
const kindAt = (node: Node, $pos: ResolvedPos): PlaceholderKind => {
  const name = node.type.name;
  if (name === 'heading' || name === 'tableCell') return name;
  const parent = $pos.parent.type.name;
  if (parent === 'blockquote') return 'quote';
  if (parent === 'listItem' && $pos.index() === 0 && $pos.depth > 0) {
    const list = $pos.node($pos.depth - 1).type.name;
    if (list === 'bulletList' || list === 'orderedList') return list;
  }
  return 'line';
};

const kindWords = (words: PlaceholderWords, line: PlaceholderLine): string | undefined => {
  if (line.kind === 'line') return undefined;
  if (line.kind !== 'heading') return words[line.kind];
  const heading = words.heading;
  if (typeof heading === 'string' || heading === undefined) return heading;
  const level = (line.node.attrs['level'] as number) ?? 1;
  return heading[Math.min(level, heading.length) - 1];
};

/** A line's words: those it always shows, and those it shows under the
    caret only. */
interface LineWords {
  always: string;
  caret: string;
}

const lineWords = (
  text: PlaceholderText | undefined,
  line: PlaceholderLine,
  show: 'caret' | 'all',
): LineWords => {
  let always = '';
  let caret = '';
  if (typeof text === 'string') {
    caret = text;
  } else if (typeof text === 'function') {
    const words = text(line) ?? '';
    if (line.kind === 'line') caret = words;
    else always = words;
  } else if (text) {
    const own = kindWords(text, line);
    if (own !== undefined) always = own;
    else caret = (line.docEmpty ? text.empty : undefined) ?? text.line ?? '';
  }
  if (!always && (show === 'all' || line.docEmpty)) [always, caret] = [caret, ''];
  return { always, caret };
};

const lineDecoration = (node: Node, pos: number, words: string, docEmpty: boolean) =>
  Decoration.node(
    pos,
    pos + node.nodeSize,
    {
      class: docEmpty ? 'aee-placeholder aee-placeholder-doc' : 'aee-placeholder',
      'data-placeholder': words,
    },
    // The words again, for `aria-placeholder`; marks it a line's.
    { line: words },
  );

/** The decorations that show without the caret, for the nodes overlapping
    `from`–`to` (the whole document without them). */
const scan = (
  state: EditorState,
  text: PlaceholderText | undefined,
  show: 'caret' | 'all',
  from = 0,
  to = state.doc.content.size,
): Decoration[] => {
  const { doc } = state;
  const decorations: Decoration[] = [];
  const docEmpty = isDocEmpty(doc);
  const image = text && typeof text === 'object' ? text.image : undefined;
  doc.nodesBetween(from, to, (node, pos) => {
    if (image && isEmptyImage(node)) {
      // The frame's words, for its node view to read off the decoration.
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { placeholder: image }));
      return false;
    }
    if (!node.isTextblock) return true;
    if (!isBare(node)) return !!image;
    const kind = kindAt(node, doc.resolve(pos));
    const { always } = lineWords(text, { node, pos, kind, docEmpty, state }, show);
    if (always) decorations.push(lineDecoration(node, pos, always, docEmpty));
    return false;
  });
  return decorations;
};

/** Where `tr` changed its document, in the new document's positions. */
const changedRanges = (tr: Transaction): [number, number][] => {
  let ranges: [number, number][] = [];
  for (const map of tr.mapping.maps) {
    ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => ranges.push([newStart, newEnd]));
  }
  return ranges;
};

/** A changed range grown to every line whose kind it may have changed: the
    nodes it opens or closes (a list turned numbered changes only its
    boundaries), and the innermost kind-giving container around it. */
const widen = (doc: Node, from: number, to: number): [number, number] => {
  const after = doc.nodeAt(from);
  if (after && !after.isText) to = Math.max(to, from + after.nodeSize);
  const before = doc.resolve(to).nodeBefore;
  if (before && !before.isText) from = Math.min(from, to - before.nodeSize);
  const $from = doc.resolve(from);
  for (let depth = $from.sharedDepth(to); depth > 0; depth--) {
    if (KIND_CONTAINERS.has($from.node(depth).type.name)) {
      return [Math.min(from, $from.before(depth)), Math.max(to, $from.after(depth))];
    }
  }
  return [from, to];
};

/**
 * A placeholder on empty lines, Notion's way: the line the caret is on says
 * what can be done there ("Type / for commands") and the hint goes as soon as
 * a character is typed or the caret moves on, while an empty block of a kind
 * says what it is ("Heading 1", "List", "Empty quote") wherever the caret is.
 * Nothing of it is in the document — a node decoration puts a class and the
 * words on the line:
 *
 *     <div class="aee-placeholder" data-placeholder="Type / for commands">
 *
 * and the host's stylesheet paints them (`content: attr(data-placeholder)`),
 * so the look stays the host's. An empty body is also marked with
 * `aee-placeholder-doc`, and the editable element carries the words as
 * `aria-placeholder`, so a screen reader hears what the field is for. An
 * image waiting for its file gets its words through a node decoration whose
 * spec carries `placeholder`, which the image's node view puts in its frame.
 *
 * The words are the host's, in its language — the library words nothing.
 * Hand them in as {@link PlaceholderOptions.text} and replace them with the
 * `setPlaceholder` command whenever they change:
 *
 *     effect(() => editor.commands.setPlaceholder(this.placeholders()));
 *
 * Typing costs only the lines it touched: the decorations live in the
 * plugin's state, mapped through each change and redone where it landed;
 * new words redo them once.
 *
 * Code lines never show it: an empty line of source is just that. Neither
 * does a read-only editor (an image frame keeps its words), nor the line
 * mid-composition (an IME's text is not in the document yet).
 */
export const createPlaceholder = (options: PlaceholderOptions = {}): FunctionalExtension => {
  const show = options.show ?? 'caret';

  return defineExtension({
    name: 'placeholder',
    commands: () => ({ setPlaceholder }),
    plugins: () => {
      let view: EditorView | undefined;
      /** A redraw: focus is not in the state, so its change is no transaction. */
      const redraw = () => {
        if (view) view.dispatch(view.state.tr.setMeta('addToHistory', false));
        return false;
      };

      return [
        new Plugin<PlaceholderState>({
          key: placeholderKey,
          state: {
            init: (_config, state) => ({
              text: options.text,
              set: DecorationSet.create(state.doc, scan(state, options.text, show)),
            }),
            apply: (tr, value, oldState, state) => {
              const meta = tr.getMeta(placeholderKey) as { text: PlaceholderText } | undefined;
              if (meta) {
                return {
                  text: meta.text,
                  set: DecorationSet.create(tr.doc, scan(state, meta.text, show)),
                };
              }
              if (!tr.docChanged) return value;
              // Into or out of an empty body every line's class changes: redo all.
              if (isDocEmpty(tr.doc) || isDocEmpty(oldState.doc)) {
                return {
                  ...value,
                  set: DecorationSet.create(tr.doc, scan(state, value.text, show)),
                };
              }
              let set = value.set.map(tr.mapping, tr.doc);
              for (const range of changedRanges(tr)) {
                const [from, to] = widen(tr.doc, ...range);
                const stale = set.find(from, to).filter((d) => d.from < to && d.to > from);
                set = set.remove(stale).add(tr.doc, scan(state, value.text, show, from, to));
              }
              return { ...value, set };
            },
          },
          props: {
            decorations(state) {
              const plugin = placeholderKey.getState(state);
              if (!plugin) return null;
              const { doc, selection } = state;
              if (view && !view.editable) {
                const frames = plugin.set.find(undefined, undefined, (spec) => !spec['line']);
                return frames.length ? DecorationSet.create(doc, frames) : null;
              }
              const { $from } = selection;
              const line = $from.parent;
              if (!isBare(line)) return plugin.set;
              const pos = $from.before();
              // `find` also hands back the line before, which ends where this starts.
              const own = plugin.set
                .find(pos, pos + line.nodeSize, (spec) => !!spec['line'])
                .filter((decoration) => decoration.from === pos);
              // Mid-composition the caret's line is not empty, only not yet
              // in the document.
              if (view?.composing) return own.length ? plugin.set.remove(own) : plugin.set;
              if (own.length || show === 'all' || !selection.empty || !view?.hasFocus()) {
                return plugin.set;
              }
              const docEmpty = isDocEmpty(doc);
              const kind = kindAt(line, doc.resolve(pos));
              const { caret } = lineWords(
                plugin.text,
                { node: line, pos, kind, docEmpty, state },
                show,
              );
              return caret
                ? plugin.set.add(doc, [lineDecoration(line, pos, caret, docEmpty)])
                : plugin.set;
            },
            attributes(state): Record<string, string> {
              if (!isDocEmpty(state.doc)) return {};
              const line = placeholderKey
                .getState(state)
                ?.set.find(0, state.doc.firstChild!.nodeSize, (spec) => !!spec['line'])[0];
              const words = line?.spec['line'] as string | undefined;
              return words ? { 'aria-placeholder': words } : {};
            },
            handleDOMEvents: { focus: redraw, blur: redraw },
          },
          view: (editorView) => {
            view = editorView;
            return {
              destroy: () => {
                view = undefined;
              },
            };
          },
        }),
      ];
    },
  });
};
