import { Command } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension';
import { serializeToHTML } from '../html';
import { emailPlainText } from '../plain-text';
import { mergeTagFields } from './nodes/merge-tag';
import { InlineImage, inlineImageRegistry, promoteInlineImages } from './inline-images';

/**
 * What the composer hands the host when the user asks to send: the canonical
 * HTML, its `text/plain` projection — the two parts of a well-formed
 * `multipart/alternative` body — the inline image parts that HTML references
 * (`multipart/related`, should the host want it), and the personalization
 * fields the body requires. Everything else (addressing, headers, transport)
 * is the host's; nothing network-shaped lives in this library.
 */
export interface SendIntent {
  /** The canonical HTML — with every data-URL image already promoted to a
      `cid:` reference (see {@link promoteInlineImages}); the document in the
      editor keeps its data URLs. */
  html: string;
  text: string;
  /** Every inline image `html` references, in document order: promoted
      data-URL images carry their bytes, pre-existing `cid:` references
      (an imported reply's parts, which the host already owns) carry none.
      Empty when the body has no inline images — plain
      `multipart/alternative` then. */
  inlineImages: InlineImage[];
  /** Every field identifier the body's merge tags read, in first-use order —
      the values the host must resolve before the mail can render. Straight
      off the document's nodes (see `mergeTagFields`), so a host without its
      own template engine never text-parses the HTML to discover them; a host
      with one (an AngularJS-expression evaluator, say) is free to ignore
      this and scan `html` itself. Empty when the body is template-free. */
  requiredFields: string[];
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
      // The promotion lives in the payload only — no transaction, the
      // document is not touched, the editor keeps showing its data URLs.
      const { doc, images } = promoteInlineImages(state.doc, inlineImageRegistry(state));
      const html = serializeToHTML(doc, state.schema);
      options.onSend({
        html,
        text: emailPlainText(html),
        inlineImages: images,
        requiredFields: mergeTagFields(state.doc),
      });
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
