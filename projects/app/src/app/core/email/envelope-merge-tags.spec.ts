import { REMOVE_MERGE_TAG } from '@h-k-dev/angular-email-editor';

import { BLANK } from './envelope';
import { envelopeMergeTags, fillEnvelopeMergeTags } from './envelope-merge-tags';

describe('envelope merge tags', () => {
  const message = {
    ...BLANK,
    to: ['{{ email }}', 'team@example.com'],
    cc: ['{{gone}}'],
    subject: 'Hello {{ firstName }}, order {{order.number}} — {{ firstName }}',
    previewText: 'For {{ company.name }}',
    html: '<p>{{ firstName }} in the body is the editor’s</p>',
  };

  it('lists every distinct placeholder of the rows, trimmed, in reading order — not the body’s', () => {
    expect(envelopeMergeTags(message)).toEqual([
      'email',
      'gone',
      'firstName',
      'order.number',
      'company.name',
    ]);
    expect(envelopeMergeTags(BLANK)).toEqual([]);
  });

  it('fills values in, takes removals out, and keeps what has no value', () => {
    const answers = new Map<string, string | typeof REMOVE_MERGE_TAG | null>([
      ['email', 'ada@example.com'],
      ['gone', REMOVE_MERGE_TAG],
      ['firstName', 'Ada'],
      ['order.number', ''],
      ['company.name', null],
    ]);
    const filled = fillEnvelopeMergeTags(message, answers);

    expect(filled.to).toEqual(['ada@example.com', 'team@example.com']);
    // A removal that leaves an address blank takes the address with it.
    expect(filled.cc).toEqual([]);
    expect(filled.subject).toBe('Hello Ada, order {{order.number}} — Ada');
    expect(filled.previewText).toBe('For {{ company.name }}');
    // The body is the editor's to fill.
    expect(filled.html).toBe(message.html);
  });
});
