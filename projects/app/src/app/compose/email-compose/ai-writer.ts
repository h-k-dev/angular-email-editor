import { EditorState } from 'prosemirror-state';

// Library
import {
  FunctionalExtension,
  defineExtension,
  isStreaming,
  streamContent,
} from 'angular-email-editor';

import { Ai } from '../../../services/ai';

export interface AiWriterOptions {
  ai: Ai;
  /** The language to write in, asked when the writing starts. */
  language: () => 'en' | 'de' | 'ja';
}

/** The text of the caret's block up to the caret — the menu has already
    taken its own `/ai` out by the time the action runs. */
function textBefore(state: EditorState): string {
  const { $from } = state.selection;
  return $from.parent.isTextblock
    ? $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    : '';
}

/**
 * The composer's writing assistant, as an extension of its own: it declares
 * one **action**, `ai` — so it is a row of the `/` menu (and could be a
 * toolbar button) with no wiring — and, run, it writes from the caret the
 * way someone types, as the service streams its answer: a whole email on an
 * empty line, a way on after text.
 *
 * All it does itself is ask the assistant and hand on what comes back. Where
 * the next piece goes while the writer keeps typing, the caret that shows
 * it, Escape, the abort signal, `aria-busy` — that is the library's
 * `streamContent` (the editor needs `createContentStream()` in its kit).
 * The answer is HTML, so a bold phrase arrives bold.
 *
 * Nothing about AI is in the library — this is what a host writes.
 */
export const createAiWriter = ({ ai, language }: AiWriterOptions): FunctionalExtension =>
  defineExtension({
    name: 'aiWriter',
    actions: () => [
      {
        id: 'ai',
        title: 'AI: write for me',
        keywords: ['ai', 'assistant', 'write', 'continue', 'draft', 'email', 'suggest'],
        icon: 'auto_awesome',
        // One piece of writing at a time.
        isEnabled: (state) => !isStreaming(state),
        command: (state, dispatch, view) => {
          if (isStreaming(state)) return false;
          // Asked, not told.
          if (!dispatch || !view) return true;
          const request = { before: textBefore(state), language: language() };
          streamContent(
            view,
            state.selection.from,
            async ({ write, signal }) => {
              for await (const piece of ai.write(request, { signal })) write(piece);
            },
            { format: 'html' },
          ).done.catch((reason) => console.error(reason));
          return true;
        },
      },
    ],
  });
