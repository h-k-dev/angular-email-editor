import { AttachmentRef } from '../../../services/attachment-uploads';

/**
 * The message as the form holds it: what the user controls, and nothing
 * derived. The text projection, the inline parts and the cid promotion are
 * the editor's to produce at send time (`EmailMessage`); the attachment
 * bytes are the store's, by id. Every row on the sheet is a field of this.
 */
export interface Envelope {
  from: string[];
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  attachments: AttachmentRef[];
}

/** The message a sheet starts from, and starts over from after a send or a
    discard. */
export const BLANK: Envelope = {
  from: ['you@example.com'],
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  html: '',
  attachments: [],
};

/** Whether a body has anything to send: some text, or an image. An empty
    editor still serializes to a paragraph, so `required` cannot tell. */
export function hasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return text.trim().length > 0;
}

/** Nobody has written anything: no recipient, subject, attachment or body,
    and the sender as it started. An attachment still uploading counts —
    the user put it there. */
export function isBlank(message: Envelope): boolean {
  const { from, to, cc, bcc, subject, html, attachments } = message;
  return (
    !to.length &&
    !cc.length &&
    !bcc.length &&
    !subject.trim() &&
    !attachments.length &&
    from.join() === BLANK.from.join() &&
    !hasContent(html)
  );
}
