import { Command, EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { GUIDES_PEEK_EVENT, isPeeking } from './layout-guides';
import {
  MERGE_TAG_PREVIEW_CLASS,
  MERGE_TAG_PREVIEWED_CLASS,
  hasMergeTagPreview,
  mergeTagPreviewShows,
  previewMergeTag,
} from './merge-tag-preview';
import {
  editFilledValue,
  filledMergeTagAt,
  hasMergeTagResolution,
  removeMergeTagAt,
  resetFilledValue,
  resolveMergeTagAt,
  restoreMergeTag,
  writeMergeTagAt,
} from './merge-tag-resolution';
import { mergeTagAt } from './nodes/merge-tag';

/**
 * What a placeholder is, where the pointer found it:
 *
 * - `token` — as written, `{{ expr }}`: before any parse (or one the host
 *   had no value for);
 * - `previewed` — a token drawn as its value, the document untouched
 *   ({@link createMergeTagPreview});
 * - `filled` — a value written in its token's place
 *   ({@link createMergeTagResolution}).
 */
export type MergeTagState = 'token' | 'previewed' | 'filled';

/**
 * A placeholder under the pointer while the peek key is held (⌘ on a Mac,
 * Ctrl elsewhere) — what the host's card shows, and what it can do. One
 * shape for every state and every kind of editor: a way that does not apply
 * is simply not there, so a card offers the rows it finds.
 *
 * | state       | a message (the fill)                 | a template (the preview)        |
 * | ----------- | ------------------------------------ | ------------------------------- |
 * | `token`     | `parse`, `write`, `remove`           | `parse`, `remove`               |
 * | `previewed` | —                                    | `unparse`, `remove`             |
 * | `filled`    | `edit`, `reset`, `restore`           | —                               |
 *
 * Every way is one step, undone with Mod-Z — but those of the preview,
 * which write nothing. Each says whether it did anything; false when the
 * placeholder is gone meanwhile.
 */
export interface MergeTagHover {
  /** The placeholder's piece under the pointer — the card's anchor. */
  element: HTMLElement;
  state: MergeTagState;
  /** Its expression, trimmed — as the host is asked for it. */
  expr: string;
  /** The value: as filled in (`filled`), as drawn (`previewed`); `''` for a
      token. A line break is `\n`. */
  value: string;
  /** What reads there now — the value, or what was written over it by hand
      (`filled`); what an edit field starts with. `''` for a token. */
  text: string;
  /** A filled value written over by hand. */
  edited: boolean;

  /**
   * Parses this placeholder alone. In a message its value is written in
   * its place ({@link resolveMergeTagAt}: this token only); in a template
   * it is drawn over it ({@link previewMergeTag}: wherever the expression
   * stands). The host's evaluator is asked for the one expression; with no
   * value the token stays.
   */
  parse?: () => boolean;
  /** Writes `text` in the token's place by hand, still the token's
      ({@link writeMergeTagAt}). A message's only: in a template it would
      be one record's text for every reader. */
  write?: (text: string) => boolean;
  /** Takes the placeholder out, the text closed up behind it
      ({@link removeMergeTagAt}). */
  remove?: () => boolean;
  /** A previewed value, as written again ({@link previewMergeTag}). */
  unparse?: () => boolean;
  /** Writes `text` over a filled value by hand ({@link editFilledValue}). */
  edit?: (text: string) => boolean;
  /** Takes back the value as filled in ({@link resetFilledValue}) — there
      only while it is written over. */
  reset?: () => boolean;
  /** Puts the token back in a filled value's place ({@link restoreMergeTag}). */
  restore?: () => boolean;
}

export interface MergeTagHoverOptions {
  /**
   * Told when the pointer comes onto a placeholder while the peek key is
   * held (the layout guides' peek), and `null` when it leaves — the host's
   * card. One already up stays while the pointer is on its placeholder,
   * the key released or not, so the card can be reached; told again (the
   * same `element`) when the placeholder changes under it.
   */
  onHover: (hover: MergeTagHover | null) => void;
}

const FILLED = '[data-aee-filled]';
const PREVIEWED = `.${MERGE_TAG_PREVIEW_CLASS}`;
const TOKEN = '.aee-merge-tag';
const PREVIEWED_TOKEN = `.${MERGE_TAG_PREVIEWED_CLASS}`;

/** The placeholder's piece `target` is in, nearest first. */
const pieceOf = (view: EditorView, target: EventTarget | null): HTMLElement | null => {
  const piece =
    (target as Element | null)?.closest?.<HTMLElement>(`${FILLED}, ${PREVIEWED}, ${TOKEN}`) ?? null;
  return piece && view.dom.contains(piece) ? piece : null;
};

/**
 * The placeholder `element` is a piece of — a token's pill, a previewed
 * value, a filled value — with what can be done to it in this editor. Null
 * when it is none, or gone from the page. What a card needs for a
 * placeholder it was pointed at some other way than the pointer (a form
 * that put the caret on a token without a value).
 */
export function mergeTagHoverOf(view: EditorView, element: HTMLElement): MergeTagHover | null {
  if (!element.isConnected || view.isDestroyed || !view.dom.contains(element)) return null;
  /** Runs a command made for where the piece stands now. */
  const run = (command: (pos: number) => Command, focus = true) => {
    if (!element.isConnected || view.isDestroyed) return false;
    const done = command(view.posAtDOM(element, 0))(view.state, view.dispatch, view);
    if (done && focus) view.focus();
    return done;
  };
  const state: EditorState = view.state;

  if (element.matches(FILLED)) {
    const filled = filledMergeTagAt(state.doc, view.posAtDOM(element, 0));
    if (!filled) return null;
    return {
      element,
      state: 'filled',
      expr: filled.expr,
      value: filled.value,
      text: filled.text,
      edited: filled.edited,
      edit: (text) => run((pos) => editFilledValue(text, pos)),
      ...(filled.edited && filled.value ? { reset: () => run(resetFilledValue) } : {}),
      restore: () => run(restoreMergeTag),
    };
  }

  if (element.matches(PREVIEWED)) {
    const expr = element.getAttribute('data-aee-expr') ?? '';
    if (!expr) return null;
    const value = element.innerText ?? element.textContent ?? '';
    return {
      element,
      state: 'previewed',
      expr,
      value,
      text: value,
      edited: false,
      unparse: () => run(() => previewMergeTag(expr, false), false),
      // The widget stands right before its token.
      remove: () => run(removeMergeTagAt),
    };
  }

  const tag = mergeTagAt(state.doc, view.posAtDOM(element, 0));
  if (!tag) return null;
  const expr = tag.expr.trim();
  // Hidden behind its value: the value is the piece to point at.
  if (
    mergeTagPreviewShows(state, expr) &&
    (element.matches(PREVIEWED_TOKEN) || element.querySelector(PREVIEWED_TOKEN))
  ) {
    return null;
  }
  const fills = hasMergeTagResolution(state);
  const previews = hasMergeTagPreview(state);
  return {
    element,
    state: 'token',
    expr,
    value: '',
    text: '',
    edited: false,
    ...(fills
      ? { parse: () => run(resolveMergeTagAt) }
      : previews
        ? { parse: () => run(() => previewMergeTag(expr, true), false) }
        : {}),
    ...(fills ? { write: (text: string) => run((pos) => writeMergeTagAt(text, pos)) } : {}),
    remove: () => run(removeMergeTagAt),
  };
}

/**
 * The placeholders' hover, for a card: every placeholder of the text — a
 * token, a previewed value, a filled value — reported to the host while
 * the peek key is held over it ({@link MergeTagHoverOptions.onHover}), each
 * with what this editor can do to it ({@link MergeTagHover}).
 *
 * One report for a message and for a template: add it beside the fill
 * ({@link createMergeTagResolution}), the preview
 * ({@link createMergeTagPreview}), both or neither — the ways offered
 * follow what the kit holds. It takes the place of the fill's own
 * `onFilledHover`, which knows filled values only; wire one of the two.
 *
 * Needs the layout guides' peek (`createLayoutGuides`): without it the
 * peek key is never held, and nothing is reported.
 */
export const createMergeTagHover = (options: MergeTagHoverOptions): FunctionalExtension =>
  defineExtension({
    name: 'mergeTagHover',
    plugins: () => [
      new Plugin({
        view: (view) => {
          /** The piece under the pointer, peek or not. */
          let over: HTMLElement | null = null;
          /** The piece reported. */
          let shown: HTMLElement | null = null;

          const report = (piece: HTMLElement | null) => {
            const hover = piece && mergeTagHoverOf(view, piece);
            shown = hover ? piece : null;
            options.onHover(hover);
          };
          const sync = () => {
            const next = over && over.isConnected && (isPeeking(view) || over === shown) ? over : null;
            if (next === shown) return;
            report(next);
          };
          const onOver = (event: MouseEvent) => {
            over = pieceOf(view, event.target);
            sync();
          };
          const onLeave = () => {
            over = null;
            sync();
          };

          view.dom.addEventListener('mouseover', onOver);
          view.dom.addEventListener('mouseleave', onLeave);
          view.dom.addEventListener(GUIDES_PEEK_EVENT, sync);
          return {
            update: (_, before) => {
              const kept = shown;
              if (kept && !kept.isConnected) {
                // Gone from the page: a parse wrote its value, a preview
                // drew over it.
                if (over === kept) over = null;
                report(null);
                return;
              }
              sync();
              // Still there, and something changed: read it anew.
              if (kept && kept === shown && before !== view.state) report(kept);
            },
            destroy: () => {
              view.dom.removeEventListener('mouseover', onOver);
              view.dom.removeEventListener('mouseleave', onLeave);
              view.dom.removeEventListener(GUIDES_PEEK_EVENT, sync);
              if (shown) options.onHover(null);
            },
          };
        },
      }),
    ],
  });
