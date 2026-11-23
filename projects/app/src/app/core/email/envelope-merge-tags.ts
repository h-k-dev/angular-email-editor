import {
  fillMergeTagsInText,
  mergeTagExpressionsInText,
  type MergeTagAnswer,
} from '@h-k-dev/angular-email-editor';

import type { Envelope } from './envelope';

/** The envelope's rows that may hold placeholders — every one a person
    writes on: the addresses, the subject, the preview text. */
type EnvelopeText = Pick<Envelope, 'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'previewText'>;

/** Every distinct placeholder in the envelope's rows, in reading order —
    what a fill asks the evaluator for beside the body's (whose tokens are
    the editor's to fill). Empty when the rows hold none. */
export function envelopeMergeTags(message: EnvelopeText): string[] {
  return mergeTagExpressionsInText([
    ...message.from,
    ...message.to,
    ...message.cc,
    ...message.bcc,
    message.subject,
    message.previewText,
  ]);
}

/** The envelope's rows with their placeholders filled in from `answers`
    (by expression) — the library's rules (`fillMergeTagsInText`); the rest
    of the message as it is. An address a removal leaves blank goes from its
    row. */
export function fillEnvelopeMergeTags<T extends EnvelopeText>(
  message: T,
  answers: ReadonlyMap<string, MergeTagAnswer>,
): T {
  const addresses = (list: readonly string[]) =>
    list
      .map((address) => fillMergeTagsInText(address, answers).trim())
      .filter((address) => !!address);
  return {
    ...message,
    from: addresses(message.from),
    to: addresses(message.to),
    cc: addresses(message.cc),
    bcc: addresses(message.bcc),
    subject: fillMergeTagsInText(message.subject, answers),
    previewText: fillMergeTagsInText(message.previewText, answers),
  };
}
