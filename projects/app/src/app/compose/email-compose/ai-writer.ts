import { EditorState } from 'prosemirror-state';

// Library
import { FunctionalExtension, defineExtension } from 'angular-email-editor';

/** What the writer asked from: where the caret is and what stands before
    it — the assistant reads that, and the answer is proposed for there. */
export interface AiAsk {
  /** The text of the caret's block up to the caret. */
  before: string;
}

export interface AiWriterOptions {
  /** Told when the writer asks for the assistant — the composer opens its
      panel, which streams, takes instructions, and inserts on Accept. */
  onAsk: (ask: AiAsk) => void;
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
 * toolbar button) with no wiring. Run, it asks the composer to open its
 * assistant panel (`AiPanel`) for the caret: the answer streams *there*, on
 * a layer of its own over the text, where the writer reads it, steers it
 * with instructions, and takes it into the message with Accept — or lets
 * it go, and the message is as it was. Nothing is written into the
 * document until it is accepted, so the action itself changes no state:
 * asked whether it can run, it says yes and does nothing.
 *
 * Nothing about AI is in the library — this is what a host writes.
 */
export const createAiWriter = ({ onAsk }: AiWriterOptions): FunctionalExtension =>
  defineExtension({
    name: 'aiWriter',
    actions: () => [
      {
        id: 'ai',
        title: 'AI: write for me',
        keywords: ['ai', 'assistant', 'write', 'continue', 'draft', 'email', 'suggest'],
        icon: 'auto_awesome',
        command: (state, dispatch) => {
          // Asked, not told.
          if (!dispatch) return true;
          onAsk({ before: textBefore(state) });
          return true;
        },
      },
    ],
  });
