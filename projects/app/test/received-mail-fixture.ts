import type { Provider } from '@angular/core';

import { ExampleAssets } from '../src/app/core/email/examples';

/** The inbox's listing as `scripts/inbox-listing.mjs` writes it, for a few
    of the catalogue's messages as they ship: an inbound HTML message, a
    text-only one, and an MJML newsletter. */
const LISTING = {
  mails: [
    {
      id: 'reply-plain-note',
      file: 'reply/plain-note.json',
      kind: 'reply',
      name: 'Jane Doe',
      from: 'Jane Doe <jane@example.com>',
      date: 'Aug 18, 2026, 4:32 PM',
      subject: 'Plain note',
    },
    {
      id: 'reply-text-only',
      file: 'reply/text-only.json',
      kind: 'reply',
      name: 'ops@example.com',
      from: 'ops@example.com',
      subject: 'Text-only',
    },
    {
      id: 'mjml-austin',
      file: 'mjml/austin.html',
      kind: 'html',
      name: 'Austin',
      from: 'Austin <austin@example.com>',
      subject: 'Discount Light',
    },
  ],
};

const FILES: Record<string, string> = {
  'inbox.json': JSON.stringify(LISTING),
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
    // As MJML writes it: a centred 600px column, a newsletter's.
    '<!doctype html><html><head><title>Discount Light</title></head>' +
    '<body><div style="margin: 0 auto; max-width: 600px"><p>Austin</p></div></body></html>',
};

/**
 * The inbox for a jsdom spec, where nothing serves the examples: the
 * `ExampleAssets` service answered from memory, so `ReceivedMail` reads
 * them as it reads the real ones. `fetched` lists every file asked for, in
 * order — what was fetched, and when.
 */
export function provideExampleMail(fetched: string[] = []): Provider {
  return {
    provide: ExampleAssets,
    useValue: {
      file: async (file: string) => {
        fetched.push(file);
        const text = FILES[file];
        if (text === undefined) throw new Error(`Example ${file}: 404`);
        return text;
      },
    },
  };
}
