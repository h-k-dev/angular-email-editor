import { Mark, Node } from 'prosemirror-model';
import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { MergeTagAnswer, REMOVE_MERGE_TAG } from './merge-tag-resolution';
import { mergeTagRanges } from './nodes/merge-tag';

/**
 * The document's placeholders **shown** as their values — and back, as often
 * as wanted: what a template's author needs, where the fill
 * ({@link createMergeTagResolution}) is what a message's writer needs.
 *
 * The fill *writes*: a value takes its token's place in the document, for a
 * mail about to go out. On a template that is the wrong thing three times —
 * saved while filled it would store one record's data as the template, a
 * token in an attribute could not be put back, and the way back is the undo
 * history's. The preview writes **nothing**:
 *
 * - the tokens stay the document's text, untouched — what is saved, what the
 *   source pane reads, what `html()` emits, whether the document is dirty:
 *   none of it knows the preview is on;
 * - each token in running text is *drawn* as its value — the token hidden
 *   (a decoration), the value a widget in its place, in the token's
 *   formatting (a bold `{{ customer_lastName }}` shows the bold name), a
 *   line break in a value a line break;
 * - off again, the tokens are there as they were: nothing to restore.
 *
 * The host is asked for each distinct expression **once, raw**, as the fill
 * asks ({@link MergeTagPreviewOptions.resolve}); a token written while the
 * preview is on is asked for when it is complete. An answer of `''`, `null`
 * or `undefined` leaves the token showing — there is no value to show —
 * and {@link REMOVE_MERGE_TAG} shows nothing in its place. Turned on again
 * while on, everything is asked afresh: another record's values.
 *
 * Tokens in attributes (a link's `href`, an image's `src`) are not drawn
 * filled: they stay as written.
 *
 * Under the layout guides' peek (⌘ held, Ctrl off a Mac) the values wear the pill's
 * colour — where the tokens are, at a glance — by the host's stylesheet
 * (`.aee-guides-peek .aee-merge-tag-preview`; the library's `merge-tags`
 * mixin does it).
 *
 * Bound to no key and declared as the `preview-placeholders` action (a
 * toggle: `<button emailAction="preview-placeholders">` is its button,
 * pressed while on); the command is `previewMergeTags`. In Angular,
 * `[emailMergeTagPreview]` (the `editor` entry) binds it to a signal.
 */
export interface MergeTagPreviewOptions {
  /**
   * Values for the distinct expressions asked for, in the same order — each
   * the trimmed text between the braces, as written. The contract of the
   * fill's `resolve` ({@link MergeTagResolutionOptions.resolve}): one
   * evaluator serves both.
   */
  resolve: (expressions: string[]) => Promise<readonly MergeTagAnswer[]>;
  /** Told when the preview goes on or off, and when a request goes out or
      settles — the host's pressed button and its spinner. */
  onChange?: (preview: MergeTagPreview) => void;
  /** Called when `resolve` rejects: the tokens asked for stay showing, and
      are not asked for again until the preview is turned on anew. */
  onError?: (error: unknown) => void;
}

/** The preview, as a host shows it. */
export interface MergeTagPreview {
  /** The values are shown in the tokens' places. */
  on: boolean;
  /** A request is out: some tokens still show as written. */
  pending: boolean;
}

/** The class of a value drawn in its token's place. */
export const MERGE_TAG_PREVIEW_CLASS = 'aee-merge-tag-preview';
/** The class on a token hidden behind its value. */
export const MERGE_TAG_PREVIEWED_CLASS = 'aee-merge-tag-previewed';

/** What an expression shows as: its value, nothing (`''` — the host took it
    out), or itself (`null` — no value). */
type Shown = string | null;

interface PreviewState {
  on: boolean;
  /** Which turning-on this is: answers of an earlier one are dropped. */
  run: number;
  values: ReadonlyMap<string, Shown>;
  /** The expressions that go their own way: shown while the rest is as
      written (`true`), or as written while the rest is shown (`false`) —
      {@link previewMergeTag}. Gone when the whole is turned on or off. */
  only: ReadonlyMap<string, boolean>;
  /** Some token of the text has no answer yet: it is out with the host. */
  pending: boolean;
  decorations: DecorationSet;
}

type PreviewMeta =
  | { on: boolean }
  | { expr: string; shown: boolean }
  | { run: number; values: ReadonlyMap<string, Shown> };

/** Whether `expr` is shown as its value: its own say, else the whole's. */
const shows = (state: Pick<PreviewState, 'on' | 'only'>, expr: string): boolean =>
  state.only.get(expr) ?? state.on;

const previewKey = new PluginKey<PreviewState>('mergeTagPreview');

/** Whether the document's placeholders are shown as their values. */
export function mergeTagPreviewOn(state: EditorState): boolean {
  return !!previewKey.getState(state)?.on;
}

/** Whether the preview is on and still waits for values: some tokens show
    as written until the host answers. */
export function mergeTagPreviewPending(state: EditorState): boolean {
  return !!previewKey.getState(state)?.pending;
}

/**
 * Shows the placeholders as their values (`true`), as written (`false`), or
 * the other of the two (no argument). `true` while already on asks for every
 * value afresh — the host's record changed. False without the extension, or
 * when there is nothing to change.
 */
export const previewMergeTags =
  (on?: boolean): Command =>
  (state, dispatch) => {
    const current = previewKey.getState(state);
    if (!current) return false;
    const next = on ?? !current.on;
    if (!next && !current.on) return false;
    dispatch?.(
      state.tr
        .setMeta(previewKey, { on: next } satisfies PreviewMeta)
        .setMeta('addToHistory', false),
    );
    return true;
  };

/**
 * Shows the one placeholder `expr` as its value (`true`), as written
 * (`false`), or the other of the two (no argument) — whatever the rest of
 * the document shows: one token previewed in a template shown as written,
 * or one token back as written in a previewed one. Every token holding
 * `expr` follows (the value is the expression's). `true` asks the host for
 * it afresh. Turning the whole preview on or off ({@link previewMergeTags})
 * ends every such exception. False without the extension.
 */
export const previewMergeTag =
  (expr: string, shown?: boolean): Command =>
  (state, dispatch) => {
    const current = previewKey.getState(state);
    const key = expr.trim();
    if (!current || !key) return false;
    dispatch?.(
      state.tr
        .setMeta(previewKey, { expr: key, shown: shown ?? !shows(current, key) } satisfies PreviewMeta)
        .setMeta('addToHistory', false),
    );
    return true;
  };

/** Whether the placeholder `expr` is shown as its value — by the whole
    preview, or its own ({@link previewMergeTag}). */
export function mergeTagPreviewShows(state: EditorState, expr: string): boolean {
  const current = previewKey.getState(state);
  return !!current && shows(current, expr.trim());
}

/** Whether the kit previews its tokens ({@link createMergeTagPreview}). */
export function hasMergeTagPreview(state: EditorState): boolean {
  return !!previewKey.getState(state);
}

/** A value as it is drawn: text, a `<br>` per line break. */
function valueElement(document: Document, expr: string, value: string): HTMLElement {
  const element = document.createElement('span');
  element.className = MERGE_TAG_PREVIEW_CLASS;
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('data-aee-expr', expr);
  value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, index) => {
      if (index > 0) element.appendChild(document.createElement('br'));
      if (line) element.appendChild(document.createTextNode(line));
    });
  return element;
}

/** Every token of running text that has something to show in its place:
    hidden, and — with a value — the value drawn before it. */
function decorate(
  doc: Node,
  values: ReadonlyMap<string, Shown>,
  state: Pick<PreviewState, 'on' | 'only'>,
): DecorationSet {
  if (!values.size) return DecorationSet.empty;
  const mergeTag = doc.type.schema.marks['mergeTag'];
  const decorations: Decoration[] = [];
  for (const tag of mergeTagRanges(doc)) {
    const expr = tag.expr.trim();
    const value = shows(state, expr) ? values.get(expr) : undefined;
    if (typeof value !== 'string') continue;
    if (value) {
      // In the token's own formatting — never its pill.
      const marks: readonly Mark[] = (doc.nodeAt(tag.from)?.marks ?? []).filter(
        (mark) => mark.type !== mergeTag,
      );
      decorations.push(
        Decoration.widget(tag.from, (view) => valueElement(view.dom.ownerDocument, expr, value), {
          side: -1,
          marks,
          key: `aee-merge-tag-preview:${expr}:${value}`,
          ignoreSelection: true,
        }),
      );
    }
    decorations.push(
      Decoration.inline(tag.from, tag.to, {
        class: MERGE_TAG_PREVIEWED_CLASS,
        // Hidden whatever the host's stylesheet includes: a token and its
        // value side by side would read as two.
        style: 'display: none',
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** The distinct expressions of the document's running text, trimmed, in the
    order they are first met. */
const expressionsOf = (doc: Node): string[] => [
  ...new Set(mergeTagRanges(doc).map((tag) => tag.expr.trim())),
];

/** Whether a token of the text that is shown has no answer yet. */
const unanswered = (
  doc: Node,
  values: ReadonlyMap<string, Shown>,
  state: Pick<PreviewState, 'on' | 'only'>,
): boolean => expressionsOf(doc).some((expr) => shows(state, expr) && !values.has(expr));

/**
 * The placeholder preview: `resolve` asks the host, the values are drawn
 * over the tokens, and the document stays the template. See
 * {@link MergeTagPreviewOptions} for the contract.
 */
export const createMergeTagPreview = (options: MergeTagPreviewOptions): FunctionalExtension => {
  /** Asks for what the preview does not know yet, and reports what changed. */
  const follow = (view: EditorView) => {
    /** The expressions out with the host, of the current run. */
    const asking = new Set<string>();
    let run = -1;
    let told: MergeTagPreview = { on: false, pending: false };

    const tell = ({ on, pending }: PreviewState) => {
      const next = { on, pending };
      if (next.on === told.on && next.pending === told.pending) return;
      told = next;
      options.onChange?.(next);
    };

    const land = (asked: number, expressions: string[], shown: Shown[]) => {
      if (view.isDestroyed || asked !== run) return;
      for (const expr of expressions) asking.delete(expr);
      const values = new Map(expressions.map((expr, index) => [expr, shown[index]] as const));
      view.dispatch(
        view.state.tr
          .setMeta(previewKey, { run: asked, values } satisfies PreviewMeta)
          .setMeta('addToHistory', false),
      );
    };

    const sync = () => {
      const state = previewKey.getState(view.state);
      if (!state) return;
      if (state.run !== run) {
        run = state.run;
        asking.clear();
      }
      if (state.on || state.only.size) {
        const unknown = expressionsOf(view.state.doc).filter(
          (expr) => shows(state, expr) && !state.values.has(expr) && !asking.has(expr),
        );
        if (unknown.length) {
          for (const expr of unknown) asking.add(expr);
          const asked = run;
          let answer: Promise<readonly MergeTagAnswer[]>;
          try {
            answer = Promise.resolve(options.resolve(unknown));
          } catch (error) {
            answer = Promise.reject(error);
          }
          answer.then(
            (answers) =>
              land(
                asked,
                unknown,
                unknown.map((_, index) => {
                  const value = answers[index];
                  return value === REMOVE_MERGE_TAG ? '' : value || null;
                }),
              ),
            (error: unknown) => {
              // Kept as written, and not asked for again this run.
              land(
                asked,
                unknown,
                unknown.map(() => null),
              );
              if (!view.isDestroyed) options.onError?.(error);
            },
          );
        }
      }
      tell(state);
    };

    sync();
    return {
      update: sync,
      destroy: () => {
        run = -1;
        asking.clear();
      },
    };
  };

  return defineExtension({
    name: 'mergeTagPreview',
    plugins: () => [
      new Plugin<PreviewState>({
        key: previewKey,
        state: {
          init: () => ({
            on: false,
            run: 0,
            values: new Map(),
            only: new Map(),
            pending: false,
            decorations: DecorationSet.empty,
          }),
          apply: (tr, state) => {
            const meta = tr.getMeta(previewKey) as PreviewMeta | undefined;
            if (meta && 'on' in meta) {
              // On — also on again — starts from nothing known.
              return {
                on: meta.on,
                run: state.run + 1,
                values: new Map(),
                only: new Map(),
                // Every token is asked for as the view takes this state in.
                pending: meta.on && expressionsOf(tr.doc).length > 0,
                decorations: DecorationSet.empty,
              };
            }
            if (meta && 'expr' in meta) {
              const only = new Map(state.only);
              // Its own say only where it differs from the whole's.
              if (meta.shown === state.on) only.delete(meta.expr);
              else only.set(meta.expr, meta.shown);
              // Shown: asked for afresh, as the view takes this state in.
              const values = new Map(state.values);
              if (meta.shown) values.delete(meta.expr);
              const next = { ...state, only, values };
              return {
                ...next,
                pending: unanswered(tr.doc, values, next),
                decorations: decorate(tr.doc, values, next),
              };
            }
            if (meta && 'values' in meta) {
              if ((!state.on && !state.only.size) || meta.run !== state.run) return state;
              const values = new Map([...state.values, ...meta.values]);
              return {
                ...state,
                values,
                pending: unanswered(tr.doc, values, state),
                decorations: decorate(tr.doc, values, state),
              };
            }
            if ((!state.on && !state.only.size) || !tr.docChanged) return state;
            // The tokens are read off the text: what was written decides.
            return {
              ...state,
              pending: unanswered(tr.doc, state.values, state),
              decorations: decorate(tr.doc, state.values, state),
            };
          },
        },
        props: {
          decorations: (state) => previewKey.getState(state)?.decorations ?? null,
        },
        view: follow,
      }),
    ],
    commands: () => ({ previewMergeTags, previewMergeTag }),
    actions: () => [
      {
        id: 'preview-placeholders',
        section: 'message',
        title: 'Preview placeholders',
        keywords: ['placeholders', 'merge tags', 'preview', 'fill', 'parse', 'variables', 'fields'],
        icon: 'data_object',
        command: previewMergeTags(),
        isEnabled: () => true,
        isActive: mergeTagPreviewOn,
      },
    ],
  });
};
