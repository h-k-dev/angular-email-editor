import type { Provider } from '@angular/core';

import type { ExampleEntry, ExampleSet } from '../src/app/core/email/examples';
import { Examples } from '../src/app/core/email/examples';

/** The catalogue's own entries (public/examples/index.json) and files, a
    few of them as they ship: an inbound HTML message, a text-only one, and
    an MJML newsletter. */
const REPLY: ExampleSet = {
  key: 'reply',
  label: 'Reply example',
  short: 'Reply',
  kind: 'reply',
  examples: [
    { name: 'Plain note', file: 'reply/plain-note.json' },
    { name: 'Text-only', file: 'reply/text-only.json' },
  ],
};

const MJML: ExampleSet = {
  key: 'mjml',
  label: 'MJML template example',
  short: 'MJML',
  kind: 'html',
  examples: [{ name: 'Austin (compiled MJML, Mailjet)', file: 'mjml/austin.html' }],
};

const FILES: Record<string, string> = {
  'reply/plain-note.json': JSON.stringify({
    html: '<div>Hi,</div><div><br></div><div>Are we still on for the review tomorrow at 10?</div><div><br></div><div>Best,<br>Jane</div>',
    from: 'Jane Doe <jane@example.com>',
    date: 'Aug 18, 2026, 4:32 PM',
  }),
  'reply/text-only.json': JSON.stringify({
    text: 'Server maintenance tonight 23:00-01:00.\n\nExpect short outages.\n- Ops',
    from: 'ops@example.com',
  }),
  'mjml/austin.html':
    '<!doctype html><html><head><title>Discount Light</title></head><body><p>Austin</p></body></html>',
};

/**
 * The inbox for a jsdom spec, where nothing serves the examples: the
 * `Examples` service answered from memory, so `ReceivedMail` reads them as
 * it reads the real catalogue.
 */
export function provideExampleMail(): Provider {
  return {
    provide: Examples,
    useValue: {
      sets: async () => [REPLY, MJML],
      raw: async (entry: ExampleEntry) => FILES[entry.file],
    },
  };
}
