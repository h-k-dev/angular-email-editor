import { Plugin, PluginKey, TextSelection, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { closeHistory } from 'prosemirror-history';
import { FunctionalExtension, defineExtension } from '../extension';
import {
  ContentStreamRange,
  ContentStreamRun,
  ContentStreamWriter,
  StreamContentOptions,
  isStreaming,
  streamContent,
  streamedRange,
} from './content-stream';

/** What the extension reports: whether something is proposed, and where. */
export interface ContentProposalState {
  range: ContentStreamRange | null;
  /** The proposal is still being written. */
  streaming: boolean;
}

export interface ContentProposalOptions {
  /** The class on what is proposed — `aee-proposal` — for the host's
      stylesheet: the library paints nothing. */
  className?: string;
  /** Told when a proposal starts, grows, and ends — accepted or discarded. */
  onChange?: (state: ContentProposalState) => void;
}

interface ProposalMeta {
  range: ContentStreamRange | null;
  /** Whether the range follows the stream's own (a fresh proposal) or only
      maps through it (a revision of a part, streamed inside it). */
  snap?: boolean;
}

interface ProposalPluginState {
  range: ContentStreamRange;
  snap: boolean;
}

const key = new PluginKey<ProposalPluginState | null>('contentProposal');

/** What each editor's running proposal is stopped with. */
const runs = new WeakMap<EditorView, ContentStreamRun>();

/** Whether something is proposed in the editor — written, but not the
    writer's yet. */
export const isProposing = (state: EditorView['state']): boolean => !!key.getState(state);

/** Where the proposal stands, if there is one. */
export const proposalRange = (state: EditorView['state']): ContentStreamRange | null =>
  key.getState(state)?.range ?? null;

/**
 * Lets content be **proposed** into the document — an assistant's answer,
 * shown in the text where it would go, before the writer decides. It is
 * real content, in the document and in the HTML, so a list forms and a
 * bold phrase arrives bold where they will stand; but it is marked
 * (`aee-proposal`, for the host to paint), it stays out of the undo history,
 * and it ends one of two ways: {@link acceptProposal} commits it, as one
 * change — one undo — and {@link discardProposal} takes it out, leaving the
 * document and its history exactly as they were. Nothing else touches
 * either: a second proposal replaces the first, the editor going away
 * discards.
 *
 * Opt-in, on top of the content stream:
 *
 *     createEditor({ extensions: [...kit, createContentStream(), createContentProposal()] })
 *
 *     proposeContent(editor.view, editor.state.selection.from, async ({ write, signal }) => {
 *       for await (const token of model.stream(prompt, { signal })) write(token);
 *     }, { format: 'html' });
 *
 * The Angular side — `injectProposal`, the accept and discard triggers, an
 * input's keys — is `angular-email-editor/proposal`, its own entry: a host
 * that brings its own panel imports what it uses.
 */
export const createContentProposal = (
  options: ContentProposalOptions = {},
): FunctionalExtension => {
  const { className = 'aee-proposal' } = options;
  return defineExtension({
    name: 'contentProposal',
    plugins: () => [
      new Plugin<ProposalPluginState | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, previous) => {
            const meta = tr.getMeta(key) as ProposalMeta | undefined;
            if (meta) return meta.range ? { range: meta.range, snap: meta.snap ?? true } : null;
            if (!previous) return null;
            let { range } = previous;
            const { snap } = previous;
            // A fresh proposal follows the stream's own transaction, which
            // says exactly where it has got to. A revision streams *inside*
            // the proposal: the range maps through it like any change —
            // closing in at the edges, as the stream's does, so a stray edit
            // there is not proposed — but never below the stream's end.
            const streamed = streamedRange(tr);
            if (streamed && snap) return { range: streamed, snap };
            if (tr.docChanged) {
              const from = tr.mapping.map(range.from, 1);
              const to = Math.max(from, tr.mapping.map(range.to, -1), streamed?.to ?? from);
              range = { from, to };
            }
            return range === previous.range ? previous : { range, snap };
          },
        },
        props: {
          decorations: (state) => {
            const range = key.getState(state)?.range;
            if (!range || range.to <= range.from) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: className }),
            ]);
          },
        },
        view: (editorView) => ({
          update: (view, previous) => {
            const range = key.getState(view.state)?.range ?? null;
            const before = key.getState(previous)?.range ?? null;
            const streaming = !!range && isStreaming(view.state);
            const was = !!before && isStreaming(previous);
            if (range === before && streaming === was) return;
            options.onChange?.({ range, streaming });
          },
          // The editor going away takes its proposal with it — nothing is
          // committed by accident.
          destroy: () => runs.get(editorView)?.stop(),
        }),
      }),
    ],
  });
};

/**
 * Proposes content at `target` — a position, or a range the proposal
 * replaces — streamed in by `callback` (see `streamContent`, whose options
 * these are). A proposal already there is discarded first. Needs
 * {@link createContentProposal} and `createContentStream` in the kit.
 */
export function proposeContent(
  view: EditorView,
  target: number | ContentStreamRange,
  callback: (writer: ContentStreamWriter) => Promise<void> | void,
  options: Omit<StreamContentOptions, 'history'> = {},
): ContentStreamRun {
  if (key.get(view.state) === undefined) {
    throw new Error('proposeContent: add createContentProposal() to the editor’s extensions');
  }
  let start = typeof target === 'number' ? { from: target, to: target } : target;
  // A proposal already there goes first — and the target, given with it
  // still in the text (the caret at its end, say), is mapped through its
  // going: a position inside it lands where it began.
  const discard = discardTransaction(view);
  if (discard) {
    start = {
      from: discard.mapping.map(start.from, -1),
      to: discard.mapping.map(start.to, -1),
    };
    view.dispatch(discard);
  }
  view.dispatch(
    view.state.tr
      .setMeta(key, { range: start } satisfies ProposalMeta)
      .setMeta('addToHistory', false),
  );
  const run = streamContent(view, start, callback, { ...options, history: false });
  runs.set(view, run);
  run.done.finally(() => {
    if (runs.get(view) === run) runs.delete(view);
  });
  return run;
}

/**
 * Revises a *part* of the proposal: `range`, inside it, is replaced by what
 * `callback` streams — "rewrite this bit" — while the rest of the proposal
 * stands, still proposed, and the whole is accepted or discarded together
 * as before. Null (and nothing streamed) when no proposal holds the range.
 */
export function reviseProposal(
  view: EditorView,
  range: ContentStreamRange,
  callback: (writer: ContentStreamWriter) => Promise<void> | void,
  options: Omit<StreamContentOptions, 'history'> = {},
): ContentStreamRun | null {
  const current = key.getState(view.state);
  if (!current || range.from < current.range.from || range.to > current.range.to) return null;
  stopProposal(view);
  // Mapping, not following: the stream's range is the part's, not the
  // proposal's.
  view.dispatch(
    view.state.tr
      .setMeta(key, { range: current.range, snap: false } satisfies ProposalMeta)
      .setMeta('addToHistory', false),
  );
  const run = streamContent(view, range, callback, { ...options, history: false });
  runs.set(view, run);
  run.done.finally(() => {
    if (runs.get(view) === run) runs.delete(view);
  });
  return run;
}

/** Stops the writing where it is; what is proposed stays proposed. */
export function stopProposal(view: EditorView): void {
  runs.get(view)?.stop();
}

/**
 * Takes the proposal into the document for good: the same content, now
 * the writer's own — one change in the history, so one undo takes all of
 * it back. The caret lands after it. False when nothing is proposed.
 */
export function acceptProposal(view: EditorView): boolean {
  const range = key.getState(view.state)?.range;
  if (!range) return false;
  stopProposal(view);
  const { from, to } = range;
  const slice = view.state.doc.slice(from, to);
  // Out, without a trace — and in again as one ordinary change. The same
  // slice at the same place is the same document; only the history knows.
  view.dispatch(
    view.state.tr
      .delete(from, to)
      .setMeta(key, { range: null } satisfies ProposalMeta)
      .setMeta('addToHistory', false),
  );
  const tr = view.state.tr.replace(from, from, slice);
  const end = tr.mapping.map(from + (to - from), 1);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
  view.dispatch(closeHistory(tr).scrollIntoView());
  return true;
}

/**
 * Takes the proposal out, as if it had never been written: the document
 * and its history are as they were, the caret where the proposal began.
 * False when nothing is proposed.
 */
export function discardProposal(view: EditorView): boolean {
  const tr = discardTransaction(view);
  if (!tr) return false;
  view.dispatch(tr);
  return true;
}

/** The transaction that takes the proposal out — stopping the writing
    first — or null when nothing is proposed. */
function discardTransaction(view: EditorView): Transaction | null {
  const range = key.getState(view.state)?.range;
  if (!range) return null;
  stopProposal(view);
  const tr = view.state.tr
    .delete(range.from, range.to)
    .setMeta(key, { range: null } satisfies ProposalMeta)
    .setMeta('addToHistory', false);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(range.from, tr.doc.content.size))));
  return tr;
}
