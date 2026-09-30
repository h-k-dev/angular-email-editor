import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { DOMSerializer, Node, Schema } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import { parseHTML, serializeToHTML } from '../html';

/**
 * The quoted history a reply or forward answers — Gmail's `⋯` — kept
 * **beside** the body, never in it.
 *
 * - **It stays.** The history is the document's `quoted` attribute, not its
 *   content: a template applied, an `.eml` dropped, the source pane
 *   rewritten — anything that replaces the body (`setContent`, `setText`,
 *   `replaceHTML`) leaves it where it is. `getHTML()` is the body alone.
 * - **Only a deliberate step changes it.** The trash drops it; Edit moves it
 *   into the body, where it is ordinary text from then on. Both are steps of
 *   the document, so one undo brings it back — Edit's undo takes the text
 *   out of the body again in the same step.
 * - **It is sent.** The send intent puts it under the body
 *   ({@link withQuoted}): HTML, plain text and inline images alike.
 * - **It is what the schema keeps.** Whatever comes in is parsed through the
 *   schema the way a paste is — foreign markup repaired, unsafe markup gone —
 *   and held as canonical HTML.
 *
 * It renders as a widget after the last block — read-only, folded behind a
 * `⋯` toggle, with Edit and a trash beside it. Behaviour and structure ship
 * here; pixels are the host's, through `.aee-quoted` and its `data-slot`
 * parts (`bar`, `fold`, `edit`, `remove`, `content`), the fold button keeping
 * its `.aee-quote-fold` class.
 */
export interface QuotedHistoryLabels {
  /** The fold toggle while folded. Default "Show quoted text". */
  show?: QuotedHistoryLabel;
  /** The fold toggle while open. Default "Hide quoted text". */
  hide?: QuotedHistoryLabel;
  /** Moves the history into the body. Default "Edit quoted text". */
  edit?: QuotedHistoryLabel;
  /** Drops the history. Default "Remove quoted text". */
  remove?: QuotedHistoryLabel;
}

/** A word, or a function asked for it each time the widget is drawn or
    brought up to date — so a language switched at runtime reaches it. */
export type QuotedHistoryLabel = string | (() => string);

const word = (label: QuotedHistoryLabel): string => (typeof label === 'function' ? label() : label);

export interface QuotedHistoryOptions {
  /** The widget's words, in the host's language; each left out stays English. */
  labels?: QuotedHistoryLabels;
}

const ENGLISH: Required<QuotedHistoryLabels> = {
  show: 'Show quoted text',
  hide: 'Hide quoted text',
  edit: 'Edit quoted text',
  remove: 'Remove quoted text',
};

/** The quoted history, as canonical HTML, or null. */
export function quotedHistory(state: EditorState): string | null {
  return (state.doc.attrs['quoted'] as string | null | undefined) ?? null;
}

/** Whether the quoted history is folded behind its `⋯` — true while there
    is one and the user has not opened it. */
export function isQuotedHistoryFolded(state: EditorState): boolean {
  return quotedHistory(state) !== null && !quotedKey.getState(state)?.expanded;
}

/** The history as schema content — parsed the way a paste is. */
function quotedContent(html: string, schema: Schema): Node {
  return parseHTML(html, schema);
}

/** The document with its quoted history under the body — what is sent. */
export function withQuoted(doc: Node): Node {
  const quoted = doc.attrs['quoted'] as string | null | undefined;
  if (!quoted) return doc;
  const history = quotedContent(quoted, doc.type.schema);
  return doc.type.create(doc.attrs, doc.content.append(history.content), doc.marks);
}

/** Sets the quoted history — sanitized through the schema — or drops it.
    False when that is what it already is. A host's own sync marks the
    transaction as such (the editor's `setQuoted` does). */
export const setQuotedHistory =
  (html: string | null): Command =>
  (state, dispatch) => {
    const canonical = html ? serializeToHTML(quotedContent(html, state.schema), state.schema) : null;
    if (canonical === quotedHistory(state)) return false;
    dispatch?.(state.tr.setDocAttribute('quoted', canonical));
    return true;
  };

/** The trash: the history goes — as a step, so undo brings it back. */
export const removeQuotedHistory: Command = (state, dispatch) => {
  if (quotedHistory(state) === null) return false;
  dispatch?.(state.tr.setDocAttribute('quoted', null));
  return true;
};

/** Edit: the history moves to the end of the body, as ordinary text, and
    stops being kept — one step, so one undo reverses both. */
export const editQuotedHistory: Command = (state, dispatch) => {
  const quoted = quotedHistory(state);
  if (quoted === null) return false;
  if (dispatch) {
    const content = quotedContent(quoted, state.schema).content;
    dispatch(
      state.tr
        .insert(state.doc.content.size, content)
        .setDocAttribute('quoted', null)
        .scrollIntoView(),
    );
  }
  return true;
};

interface QuotedState {
  /** The user opened the fold. A new history starts folded again. */
  expanded: boolean;
  /** Counts the histories this editor has held — the widget re-renders when
      it moves, and only then. */
  version: number;
}

type QuotedMeta = { expanded: boolean };

const quotedKey = new PluginKey<QuotedState>('quotedHistory');

const setExpanded =
  (expanded: boolean): Command =>
  (state, dispatch) => {
    if (quotedHistory(state) === null || isQuotedHistoryFolded(state) === !expanded) return false;
    dispatch?.(state.tr.setMeta(quotedKey, { expanded } satisfies QuotedMeta));
    return true;
  };

/** The quoted history as an editor extension — see {@link QuotedHistoryLabels}
    for its words. The email kit carries it as {@link QuotedHistory}. */
export function createQuotedHistory(options: QuotedHistoryOptions = {}): FunctionalExtension {
  const labels = { ...ENGLISH, ...options.labels };

  return defineExtension({
    name: 'quotedHistory',
    commands: () => ({
      /** Shows the quoted history (the `⋯` button's action). */
      expandQuotedHistory: (): Command => setExpanded(true),
      /** Folds it back behind the `⋯`. */
      foldQuotedHistory: (): Command => setExpanded(false),
      /** Moves it into the body as ordinary text. */
      editQuotedHistory: (): Command => editQuotedHistory,
      /** Drops it. */
      removeQuotedHistory: (): Command => removeQuotedHistory,
      /** Replaces it — sanitized — or drops it with `null`. */
      setQuotedHistory: (html: string | null): Command => setQuotedHistory(html),
    }),
    plugins: () => [
      new Plugin<QuotedState>({
        key: quotedKey,
        state: {
          init: () => ({ expanded: false, version: 0 }),
          apply(tr, value): QuotedState {
            let next = value;
            if (tr.docChanged && tr.before.attrs['quoted'] !== tr.doc.attrs['quoted']) {
              next = { expanded: false, version: value.version + 1 };
            }
            const meta = tr.getMeta(quotedKey) as QuotedMeta | undefined;
            if (meta && meta.expanded !== next.expanded) next = { ...next, expanded: meta.expanded };
            return next;
          },
        },
        props: {
          decorations(state) {
            const quoted = quotedHistory(state);
            if (quoted === null) return null;
            const { version } = quotedKey.getState(state)!;
            return DecorationSet.create(state.doc, [
              Decoration.widget(state.doc.content.size, (view) => render(view, quoted, labels), {
                side: 1,
                key: `aee-quoted-${version}`,
                ignoreSelection: true,
                stopEvent: () => true,
              }),
            ]);
          },
        },
        // The fold is state, the widget keeps its element across it — so a
        // keyboard user's focus stays on the toggle they pressed.
        view: (view) => {
          reflect(view, labels);
          return { update: (updated) => reflect(updated, labels) };
        },
      }),
    ],
  });
}

/** The email kit's quoted history, in English. */
export const QuotedHistory = createQuotedHistory();

function render(view: EditorView, quoted: string, labels: Required<QuotedHistoryLabels>): HTMLElement {
  const doc = view.dom.ownerDocument;
  const box = doc.createElement('div');
  box.className = 'aee-quoted';
  box.setAttribute('contenteditable', 'false');

  const bar = doc.createElement('div');
  bar.dataset['slot'] = 'bar';
  const button = (slot: string, className: string, run: Command, icon: string) => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.dataset['slot'] = slot;
    if (className) element.className = className;
    element.innerHTML = icon;
    // A presentation toggle or a command, never a caret move: the editor
    // keeps its selection and focus.
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', () => run(view.state, view.dispatch, view));
    bar.appendChild(element);
  };
  button(
    'fold',
    'aee-quote-fold',
    (state, dispatch) => setExpanded(isQuotedHistoryFolded(state))(state, dispatch),
    '⋯',
  );
  button('edit', '', editQuotedHistory, PENCIL);
  button('remove', '', removeQuotedHistory, TRASH);
  box.appendChild(bar);

  const content = doc.createElement('div');
  content.dataset['slot'] = 'content';
  const history = quotedContent(quoted, view.state.schema);
  content.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(history.content, { document: doc }));
  box.appendChild(content);

  reflectOn(box, isQuotedHistoryFolded(view.state), labels);
  return box;
}

/** Brings the rendered widget in line with the fold state. */
function reflect(view: EditorView, labels: Required<QuotedHistoryLabels>): void {
  const box = view.dom.querySelector<HTMLElement>(':scope > .aee-quoted');
  if (box) reflectOn(box, isQuotedHistoryFolded(view.state), labels);
}

function reflectOn(box: HTMLElement, folded: boolean, labels: Required<QuotedHistoryLabels>): void {
  box.toggleAttribute('data-folded', folded);
  const name = (slot: string, label: QuotedHistoryLabel) => {
    const button = box.querySelector<HTMLElement>(`[data-slot=${slot}]`)!;
    button.setAttribute('aria-label', word(label));
    button.title = word(label);
    return button;
  };
  name('fold', folded ? labels.show : labels.hide).setAttribute('aria-expanded', String(!folded));
  name('edit', labels.edit);
  name('remove', labels.remove);
  box.querySelector<HTMLElement>('[data-slot=content]')!.hidden = folded;
}

// Own 1em glyphs — no icon font, no dependency; they take the button's colour.
const PENCIL =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const TRASH =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
