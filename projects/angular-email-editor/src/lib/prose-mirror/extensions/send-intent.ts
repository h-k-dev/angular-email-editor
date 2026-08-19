import { Command } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension';
import { serializeToHTML } from '../html';
import { emailPlainText } from '../plain-text';

/**
 * What the composer hands the host when the user asks to send: the canonical
 * HTML and its `text/plain` projection — the two parts of a well-formed
 * `multipart/alternative` body. Everything else (addressing, headers,
 * transport) is the host's; nothing network-shaped lives in this library.
 */
export interface SendIntent {
  html: string;
  text: string;
}

export interface SendIntentOptions {
  /** Called with the ready payload whenever the user requests a send —
      `/send`, Mod-Enter (Gmail's shortcut), or the `requestSend` command. */
  onSend: (intent: SendIntent) => void;
}

/**
 * The send affordance — an *intent*, not a transport. The user's "send" is
 * just another editor action; what it produces is a payload event the host
 * wires to its own transport, exactly like the seed side (`replyDocument`)
 * feeds the same `html` signal from the other direction.
 *
 * Three ways in, one payload: the `/send` slash item, Mod-Enter, and the
 * `requestSend` command (for a toolbar button). The slash menu deletes the
 * `/send` query text *before* running the item's command, so the emitted
 * HTML is always clean of it.
 */
export const createSendIntent = (options: SendIntentOptions): FunctionalExtension => {
  const requestSend: Command = (state, dispatch) => {
    // Probing callers (menu enablement) pass no dispatch — don't send twice.
    if (dispatch) {
      const html = serializeToHTML(state.doc, state.schema);
      options.onSend({ html, text: emailPlainText(html) });
    }
    return true;
  };

  return defineExtension({
    name: 'sendIntent',
    keymap: () => ({ 'Mod-Enter': requestSend }),
    commands: () => ({ requestSend: (): Command => requestSend }),
    slashItems: () => [
      {
        title: 'Send',
        keywords: ['send', 'mail', 'deliver', 'submit'],
        icon: 'send',
        command: requestSend,
      },
    ],
  });
};
