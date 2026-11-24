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

/** A conversation of three, as three clients wrote it — listed latest
    first, the way a mailbox hands them over. Only where a spec asks for it
    (`conversation`): the inbox's own specs count three rows. */
const CONVERSATION = [
  {
    id: 'talk-3',
    file: 'reply/talk-3.json',
    kind: 'reply',
    name: 'Ravi Patel',
    from: 'Ravi Patel <ravi@example.com>',
    date: '2026-08-18T09:40:00.000Z',
    subject: 'Re: Offsite agenda',
    messageId: '<3@x>',
    inReplyTo: '<2@x>',
    references: '<1@x> <2@x>',
  },
  {
    id: 'talk-2',
    file: 'reply/talk-2.json',
    kind: 'reply',
    name: 'Monika Weber',
    from: 'Monika Weber <monika@example.com>',
    date: '2026-08-18T08:12:00.000Z',
    subject: 'RE: Offsite agenda',
    messageId: '<2@x>',
    inReplyTo: '<1@x>',
    references: '<1@x>',
  },
  {
    id: 'talk-1',
    file: 'reply/talk-1.json',
    kind: 'reply',
    name: 'Sam Lee',
    from: 'Sam Lee <sam@example.com>',
    date: '2026-08-17T09:00:00.000Z',
    subject: 'Offsite agenda',
    messageId: '<1@x>',
  },
];

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
  'reply/talk-1.json': JSON.stringify({ html: '<div>Here is the first draft.</div>' }),
  'reply/talk-2.json': JSON.stringify({
    html:
      '<div>Could we start at two?</div><hr><div id="divRplyFwdMsg"><b>From:</b> Sam Lee</div>' +
      '<div>Here is the first draft.</div>',
  }),
  'reply/talk-3.json': JSON.stringify({
    html:
      '<div>Two works for me.</div><blockquote type="cite"><div>On 18 Aug 2026, Monika Weber wrote:</div>' +
      '<div>Could we start at two?</div></blockquote>',
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
 * order — what was fetched, and when. With `conversation`, three more
 * messages that answer one another.
 */
export function provideExampleMail(
  fetched: string[] = [],
  { conversation = false }: { conversation?: boolean } = {},
): Provider {
  const listing = JSON.stringify({
    mails: [...LISTING.mails, ...(conversation ? CONVERSATION : [])],
  });
  return {
    provide: ExampleAssets,
    useValue: {
      file: async (file: string) => {
        fetched.push(file);
        const text = file === 'inbox.json' ? listing : FILES[file];
        if (text === undefined) throw new Error(`Example ${file}: 404`);
        return text;
      },
    },
  };
}
