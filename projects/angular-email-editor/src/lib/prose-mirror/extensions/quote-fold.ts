import { Command, EditorState, PluginKey, Plugin, TextSelection } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { defineExtension } from '../extension';

/**
 * Gmail's `⋯` behaviour for quoted history: the reply's quote starts folded
 * behind a small toggle, and you type above it.
 *
 * **Presentation, never document state.** Nothing marks the fold in the
 * document — a `collapsed` attr couldn't serialize honestly (no classes, no
 * data attributes in email output), so it would be hidden state that lies
 * through the round trip. Instead everything is derived and ephemeral:
 *
 * - The *target* is derived from the document, like everything else: the
 *   **trailing top-level blockquote** ({@link historyQuoteAt}) — exactly what
 *   `replyDocument` produces. An authored trailing quote folds too; that is
 *   the same heuristic bet Gmail makes, and it is one click to open.
 * - The *state* is plugin state: the position of the quote the user expanded,
 *   mapped through edits. A reply seed replaces the document, the mapping
 *   dies with the replaced range, and the fresh quote starts folded again —
 *   no special cases, the position algebra is the behaviour.
 * - The *rendering* is decorations: the quote is hidden with an inline
 *   `display: none` (behaviour ships with the library — no app CSS required)
 *   and a `button.aee-quote-fold` widget stands in for it (the app styles the
 *   pixels via that class, per the token-class contract).
 *
 * The projections never fold: the serialized email always carries the full
 * history, the source pane always shows it, plain text is untouched. Escape
 * hatches everywhere: clicking the toggle, ArrowDown from the block above
 * (the table/columns escape convention, mirrored), or any selection entering
 * the hidden range (Ctrl-End, Ctrl-A…) — the fold auto-expands rather than
 * ever letting the cursor work invisibly.
 */
export interface HistoryQuote {
  pos: number;
  node: Node;
}

/** The fold's target: the trailing top-level blockquote, or null. */
export function historyQuoteAt(doc: Node): HistoryQuote | null {
  const last = doc.lastChild;
  if (!last || last.type.name !== 'blockquote') return null;
  return { pos: doc.content.size - last.nodeSize, node: last };
}

/** Whether the quoted history is currently folded (for toolbar state). */
export function isHistoryFolded(state: EditorState): boolean {
  const quote = historyQuoteAt(state.doc);
  if (!quote) return false;
  return quoteFoldKey.getState(state)?.expandedAt !== quote.pos;
}

interface QuoteFoldState {
  /** Position of the quote the user expanded, mapped through edits; `null`
      means folded. A document replacement deletes the mapped range, so a
      freshly seeded reply starts folded — by algebra, not by special case. */
  expandedAt: number | null;
}

type QuoteFoldMeta = { type: 'expand'; pos: number } | { type: 'fold' };

const quoteFoldKey = new PluginKey<QuoteFoldState>('quoteFold');

const expandQuote: Command = (state, dispatch) => {
  const quote = historyQuoteAt(state.doc);
  if (!quote || !isHistoryFolded(state)) return false;
  dispatch?.(
    state.tr.setMeta(quoteFoldKey, { type: 'expand', pos: quote.pos } satisfies QuoteFoldMeta),
  );
  return true;
};

const foldQuote: Command = (state, dispatch) => {
  const quote = historyQuoteAt(state.doc);
  if (!quote || isHistoryFolded(state)) return false;
  // Folding must never trap the cursor inside the hidden range.
  if (dispatch) {
    const tr = state.tr.setMeta(quoteFoldKey, { type: 'fold' } satisfies QuoteFoldMeta);
    const { from } = state.selection;
    if (from > quote.pos) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(quote.pos), -1));
    }
    dispatch(tr);
  }
  return true;
};

/** ArrowDown from the end of the block sitting right above a folded quote:
    expand and step in — the mouse-free way through the fold. */
const arrowIntoFold: Command = (state, dispatch) => {
  const quote = historyQuoteAt(state.doc);
  if (!quote || !isHistoryFolded(state)) return false;

  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false; // not at its end
  if ($from.after(1) !== quote.pos) return false; // the fold isn't what's next

  if (dispatch) {
    const tr = state.tr.setMeta(quoteFoldKey, {
      type: 'expand',
      pos: quote.pos,
    } satisfies QuoteFoldMeta);
    tr.setSelection(TextSelection.near(tr.doc.resolve(quote.pos + 1)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** The `⋯` stand-in. Behaviour is inline (mousedown guard, click-to-expand);
    pixels come from the app via the `aee-quote-fold` class. */
function foldToggle(view: EditorView): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'aee-quote-fold';
  button.textContent = '⋯';
  button.title = 'Show quoted history';
  button.setAttribute('aria-label', 'Show quoted history');
  button.setAttribute('aria-expanded', 'false');
  button.contentEditable = 'false';
  // Keep the editor's selection and focus where they are; the click is a
  // presentation toggle, not an edit.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => expandQuote(view.state, view.dispatch));
  return button;
}

export const QuoteFold = defineExtension({
  name: 'quoteFold',
  keymap: () => ({ ArrowDown: arrowIntoFold }),
  commands: () => ({
    /** Reveal the quoted history (the `⋯` button's action). */
    expandQuotedHistory: (): Command => expandQuote,
    /** Fold it back behind the `⋯` — Gmail doesn't offer this; we do. */
    foldQuotedHistory: (): Command => foldQuote,
  }),
  plugins: () => [
    new Plugin<QuoteFoldState>({
      key: quoteFoldKey,
      state: {
        init: () => ({ expandedAt: null }),
        apply(tr, value): QuoteFoldState {
          let expandedAt = value.expandedAt;
          if (expandedAt !== null && tr.docChanged) {
            const mapped = tr.mapping.mapResult(expandedAt);
            expandedAt = mapped.deleted ? null : mapped.pos;
          }
          const meta = tr.getMeta(quoteFoldKey) as QuoteFoldMeta | undefined;
          if (meta?.type === 'expand') expandedAt = meta.pos;
          if (meta?.type === 'fold') expandedAt = null;
          return expandedAt === value.expandedAt ? value : { expandedAt };
        },
      },
      // A selection can reach the hidden range without the keymap (Ctrl-End,
      // Ctrl-A, programmatic). Working invisibly is never acceptable — any
      // selection touching the fold's inside expands it.
      appendTransaction(_transactions, _oldState, newState) {
        const quote = historyQuoteAt(newState.doc);
        if (!quote || !isHistoryFolded(newState)) return null;
        const { from, to } = newState.selection;
        if (to > quote.pos && from < quote.pos + quote.node.nodeSize) {
          return newState.tr.setMeta(quoteFoldKey, {
            type: 'expand',
            pos: quote.pos,
          } satisfies QuoteFoldMeta);
        }
        return null;
      },
      props: {
        decorations(state) {
          const quote = historyQuoteAt(state.doc);
          if (!quote || !isHistoryFolded(state)) return null;
          return DecorationSet.create(state.doc, [
            Decoration.widget(quote.pos, foldToggle, { key: 'aee-quote-fold' }),
            // Inline style, not a class: hiding is behaviour and must work
            // with zero app CSS. Decorations never serialize, so the email
            // and the source pane always carry the full history.
            Decoration.node(quote.pos, quote.pos + quote.node.nodeSize, {
              class: 'aee-quote-folded',
              style: 'display: none;',
            }),
          ]);
        },
      },
    }),
  ],
});
