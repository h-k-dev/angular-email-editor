import { defaultAddressRules } from 'angular-email-editor/address';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { lintHTML } from './html-source';
import { emailExtensions } from './extensions/kits';
import {
  ComposeSeedLabels,
  InboundMessage,
  ReplyKind,
  forwardDocument,
  importLoss,
  importedDocument,
  forwardQuote,
  replyDocument,
  replyEnvelope,
  replyQuote,
  toInboundMessage,
  withQuotedHistory,
} from './reply';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const INBOUND = {
  html: '<div>Hello there</div><div><br></div><div>Best, Jane</div>',
  from: 'Jane Doe <jane@example.com>',
  date: 'Aug 12, 2026, 9:14 AM',
};

describe('replyDocument', () => {
  it('seeds typing space, attribution, and the quoted history', () => {
    const html = replyDocument(INBOUND);
    expect(html).toBe(
      '<div><br></div>' +
        '<div>On Aug 12, 2026, 9:14 AM, Jane Doe &lt;jane@example.com&gt; wrote:</div>' +
        '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Hello there</div><div><br></div><div>Best, Jane</div></blockquote>',
    );
  });

  it('is a canonical fixpoint and lint-clean', () => {
    const html = replyDocument(INBOUND);
    expect(canonical(html)).toBe(html);
    expect(lintHTML(html)).toEqual([]);
  });

  it('parses the inbound body through the schema — foreign markup is repaired, unsafe dies', () => {
    const html = replyDocument({
      html:
        '<p class="MsoNormal">Word text</p>' +
        '<script>alert(1)</script>' +
        '<img src="javascript:evil()">',
      from: 'Attacker',
    });
    expect(html).toContain(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Word text</div></blockquote>',
    );
    expect(html).not.toContain('script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('class=');
  });

  it("absorbs Gmail's own quote markup — classes drop, nesting survives", () => {
    const html = replyDocument({
      html:
        '<div dir="ltr">Sure!</div>' +
        '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">' +
        '<div>Original</div></blockquote>',
      from: 'Jane',
    });
    expect(html).toContain(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Sure!</div><blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Original</div></blockquote></blockquote>',
    );
    expect(html).not.toContain('gmail_quote');
    expect(canonical(html)).toBe(html);
  });

  it('falls back to the text/plain part, one paragraph per line', () => {
    const html = replyDocument({ text: 'line one\n\nline two', from: 'Jane' });
    expect(html).toContain(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>line one</div><div><br></div><div>line two</div></blockquote>',
    );
  });

  it('degrades the attribution gracefully with partial data', () => {
    expect(replyDocument({ text: 'x', from: 'Jane' })).toContain('<div>Jane wrote:</div>');
    expect(replyDocument({ text: 'x', date: 'yesterday' })).toContain('<div>On yesterday:</div>');
    // No metadata: the quote stands on its own, no attribution paragraph.
    expect(replyDocument({ text: 'x' })).toBe(
      '<div><br></div><blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>x</div></blockquote>',
    );
  });

  it('formats a Date via Intl with the given locale, deterministically', () => {
    const date = new Date(2026, 7, 12, 9, 14); // local time, so the test is TZ-proof
    const expected = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
    expect(replyDocument({ text: 'x', from: 'Jane', date })).toContain(
      `On ${expected}, Jane wrote:`,
    );
  });

  it('quotes an empty inbound as an empty line rather than invalid markup', () => {
    const html = replyDocument({});
    expect(html).toBe(
      '<div><br></div><blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div><br></div></blockquote>',
    );
    expect(canonical(html)).toBe(html);
  });
});

describe('toInboundMessage', () => {
  // Shaped like postal-mime's `Email` — the adapter is duck-typed on purpose,
  // so these plain objects are exactly what a real parse hands over.
  it('bridges a parser result into the seeds', () => {
    const inbound = toInboundMessage({
      html: '<div>Body</div>',
      text: 'Body',
      subject: 'Café plans — Friday',
      date: '2026-08-18T14:32:00.000Z',
      from: { name: 'Jane Doe', address: 'jane@example.com' },
      to: [{ name: 'You', address: 'you@example.com' }, { address: 'ops@example.com' }],
    });
    expect(inbound.from).toBe('Jane Doe <jane@example.com>');
    expect(inbound.to).toBe('You <you@example.com>, ops@example.com');
    expect(inbound.subject).toBe('Café plans — Friday');
    expect(inbound.date).toBeInstanceOf(Date); // the seeds Intl-format it
    expect(inbound.html).toBe('<div>Body</div>');
  });

  it('tolerates a partial or null-riddled parse — every field optional', () => {
    const inbound = toInboundMessage({ html: null, text: 'hi', from: null, date: 'no idea when' });
    expect(inbound.html).toBeUndefined();
    expect(inbound.from).toBeUndefined();
    expect(inbound.to).toBeUndefined();
    expect(inbound.date).toBe('no idea when'); // unparseable dates pass through verbatim
    expect(replyDocument(inbound)).toContain(
      '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>hi</div></blockquote>',
    );
  });

  it('carries Cc and Reply-To, and quotes a name that has to be — one mailbox stays one', () => {
    const inbound = toInboundMessage({
      from: { name: 'Jane Doe', address: 'jane@example.com' },
      to: [{ name: 'Miller, Bob', address: 'bob@example.com' }],
      cc: [{ address: 'carol@example.com' }, { name: 'Dan', address: 'dan@example.com' }],
      replyTo: [{ name: 'Support', address: 'help@example.com' }],
    });
    expect(inbound.to).toBe('"Miller, Bob" <bob@example.com>');
    expect(inbound.cc).toBe('carol@example.com, Dan <dan@example.com>');
    expect(inbound.replyTo).toBe('Support <help@example.com>');
  });

  it('takes a group as its members, as a parser hands it over (RFC 5322 §3.4)', () => {
    const inbound = toInboundMessage({
      to: [
        { name: 'Team', group: [{ address: 'a@example.com' }, { name: 'Bo', address: 'b@example.com' }] },
        { name: 'undisclosed-recipients', group: [] },
      ],
    });
    expect(inbound.to).toBe('a@example.com, Bo <b@example.com>');
  });

  it('composes end-to-end: parsed email → imported document, schema-sanitized', () => {
    const html = importedDocument(
      toInboundMessage({ html: '<p class="MsoNormal">Report.</p><script>x()</script>' }),
    );
    expect(html).toBe('<div>Report.</div>');
    expect(canonical(html)).toBe(html);
  });
});

describe('importedDocument', () => {
  it('the message becomes the document; text/plain becomes paragraphs', () => {
    expect(importedDocument({ text: 'one\n\ntwo' })).toBe(
      '<div>one</div><div><br></div><div>two</div>',
    );
  });

  it('an empty message imports as the canonical empty document', () => {
    expect(importedDocument({})).toBe('<div><br></div>');
  });
});

describe('importLoss', () => {
  it('counts elements outside the schema vocabulary, most frequent tag first', () => {
    const loss = importLoss({
      html:
        '<p class="MsoNormal"><o:p></o:p></p><center>a</center><center>b</center>' +
        '<script>x()</script>' +
        '<div>kept</div>',
    });
    expect(loss.removedElements).toBe(4);
    expect(loss.removedTags).toEqual(['center', 'o:p', 'script']);
    expect(loss.inlineImages).toBe(0);
  });

  it('tag-level vocabulary is the granularity: a legacy <font> counts as known (font[color] parses)', () => {
    expect(importLoss({ html: '<div><font color="#004a77">x</font></div>' }).removedElements).toBe(
      0,
    );
  });

  it('counts cid: images separately — they parse in but await the attachments story', () => {
    const loss = importLoss({
      html: '<div><img src="cid:part1@example"><img src="https://x.example/a.png"></div>',
    });
    expect(loss.inlineImages).toBe(1);
    expect(loss.removedElements).toBe(0);
  });

  it('treats table plumbing as structure, not loss — and our own output as lossless', () => {
    const table = '<table><tbody><tr><td>cell</td></tr></tbody></table>';
    expect(importLoss({ html: table }).removedElements).toBe(0);
    // Round trip our own canonical output: importing it must report nothing.
    expect(importLoss({ html: importedDocument({ html: table }) }).removedElements).toBe(0);
  });

  it('reports nothing for a text-only message', () => {
    expect(importLoss({ text: 'plain' })).toEqual({
      removedElements: 0,
      removedTags: [],
      inlineImages: 0,
    });
  });
});

describe('forwardDocument', () => {
  it('emits the conventional header block and the message unquoted', () => {
    const html = forwardDocument({ ...INBOUND, subject: 'Hello', to: 'You <you@example.com>' });
    expect(html).toBe(
      '<div><br></div>' +
        '<div>---------- Forwarded message ---------</div>' +
        '<div>From: Jane Doe &lt;jane@example.com&gt;</div>' +
        '<div>Date: Aug 12, 2026, 9:14 AM</div>' +
        '<div>Subject: Hello</div>' +
        '<div>To: You &lt;you@example.com&gt;</div>' +
        '<div><br></div>' +
        '<div>Hello there</div><div><br></div><div>Best, Jane</div>',
    );
    expect(canonical(html)).toBe(html);
    expect(lintHTML(html)).toEqual([]);
  });

  it('omits header lines whose data was not supplied', () => {
    const html = forwardDocument({ text: 'body', from: 'Jane' });
    expect(html).toContain('<div>From: Jane</div>');
    expect(html).not.toContain('Date:');
    expect(html).not.toContain('Subject:');
    expect(html).not.toContain('To:');
  });

  it('words the header in the host’s language', () => {
    const html = forwardDocument(
      { ...INBOUND, subject: 'Hallo', to: 'Du <du@example.com>' },
      { labels: GERMAN },
    );
    expect(html).toContain(
      '<div>---------- Weitergeleitete Nachricht ---------</div>' +
        '<div>Von: Jane Doe &lt;jane@example.com&gt;</div>' +
        '<div>Datum: Aug 12, 2026, 9:14 AM</div>' +
        '<div>Betreff: Hallo</div>' +
        '<div>An: Du &lt;du@example.com&gt;</div>',
    );
  });

  it('keeps English for the labels the host left out', () => {
    const html = forwardDocument({ text: 'body', from: 'Jane' }, { labels: { from: 'Von' } });
    expect(html).toContain('<div>---------- Forwarded message ---------</div>');
    expect(html).toContain('<div>Von: Jane</div>');
  });
});

describe('replyQuote / forwardQuote', () => {
  it('is the history alone — what replyDocument puts under an empty line', () => {
    expect(replyQuote(INBOUND)).toBe(
      '<div>On Aug 12, 2026, 9:14 AM, Jane Doe &lt;jane@example.com&gt; wrote:</div>' +
        '<blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>Hello there</div><div><br></div><div>Best, Jane</div></blockquote>',
    );
    expect(replyDocument(INBOUND)).toBe('<div><br></div>' + replyQuote(INBOUND));
  });

  it('a forward’s history is its header block and the message', () => {
    const inbound = { ...INBOUND, subject: 'Hello' };
    expect(forwardQuote(inbound)).toBe(
      '<div>---------- Forwarded message ---------</div>' +
        '<div>From: Jane Doe &lt;jane@example.com&gt;</div>' +
        '<div>Date: Aug 12, 2026, 9:14 AM</div>' +
        '<div>Subject: Hello</div>' +
        '<div><br></div>' +
        '<div>Hello there</div><div><br></div><div>Best, Jane</div>',
    );
    expect(forwardDocument(inbound)).toBe('<div><br></div>' + forwardQuote(inbound));
  });
});

describe('withQuotedHistory', () => {
  const quote = replyQuote(INBOUND);

  it('puts the history under the body — what goes out', () => {
    expect(withQuotedHistory('<div>Hi</div>', quote)).toBe('<div>Hi</div>' + quote);
    expect(withQuotedHistory('<div>Hi</div>', null)).toBe('<div>Hi</div>');
  });

  it('puts it inside a whole document’s body, the head kept', () => {
    const html = withQuotedHistory(
      '<!doctype html><html><head><title>T</title></head><body><div>Hi</div></body></html>',
      quote,
    );
    expect(html).toContain('<title>T</title>');
    expect(html).toContain('<div>Hi</div>' + quote + '</body>');
  });
});

describe('replyEnvelope', () => {
  const MESSAGE: InboundMessage = {
    from: 'Jane Doe <jane@ext.com>',
    to: 'Hong Knop <hong@iusta.io>, "Miller, Bob" <bob@ext.com>',
    cc: 'carol@ext.com',
    subject: 'Contract draft',
  };
  const self = 'hong@iusta.io';

  it('a reply answers the sender, copies nobody, and says Re:', () => {
    expect(replyEnvelope(MESSAGE, 'reply', { self })).toEqual({
      to: ['Jane Doe <jane@ext.com>'],
      cc: [],
      subject: 'Re: Contract draft',
    });
  });

  it('answers Reply-To over From when the message names one', () => {
    const message = { ...MESSAGE, replyTo: 'Support <help@ext.com>, desk@ext.com' };
    expect(replyEnvelope(message, 'reply').to).toEqual(['Support <help@ext.com>', 'desk@ext.com']);
  });

  it('a reply-all copies everyone else — never oneself, never who it is to', () => {
    expect(replyEnvelope(MESSAGE, 'reply-all', { self })).toEqual({
      to: ['Jane Doe <jane@ext.com>'],
      cc: ['"Miller, Bob" <bob@ext.com>', 'carol@ext.com'],
      subject: 'Re: Contract draft',
    });
  });

  it('keeps each recipient once, under the first name it came with, whatever the case', () => {
    const message = {
      ...MESSAGE,
      to: 'Bob <BOB@ext.com>, bob@ext.com, HONG@iusta.io',
      cc: '"Robert Miller" <bob@ext.com>, jane@EXT.com',
    };
    expect(replyEnvelope(message, 'reply-all', { self }).cc).toEqual(['Bob <BOB@ext.com>']);
  });

  it('takes several own addresses', () => {
    const message = { ...MESSAGE, cc: 'Hong <info@iusta.io>, carol@ext.com' };
    expect(
      replyEnvelope(message, 'reply-all', { self: ['hong@iusta.io', 'INFO@iusta.io'] }).cc,
    ).toEqual(['"Miller, Bob" <bob@ext.com>', 'carol@ext.com']);
  });

  it('a reply to one’s own message goes to the people it went to', () => {
    const sent = { ...MESSAGE, from: 'Hong Knop <hong@iusta.io>' };
    expect(replyEnvelope(sent, 'reply', { self }).to).toEqual(['"Miller, Bob" <bob@ext.com>']);
    expect(replyEnvelope(sent, 'reply-all', { self })).toEqual({
      to: ['"Miller, Bob" <bob@ext.com>'],
      cc: ['carol@ext.com'],
      subject: 'Re: Contract draft',
    });
  });

  it('a host’s own recipient replaces the sender; a reply-all still copies the sender', () => {
    expect(replyEnvelope(MESSAGE, 'reply', { self, to: ['customer@ext.com'] }).to).toEqual([
      'customer@ext.com',
    ]);
    expect(replyEnvelope(MESSAGE, 'reply-all', { self, to: ['customer@ext.com'] }).cc).toEqual([
      'Jane Doe <jane@ext.com>',
      '"Miller, Bob" <bob@ext.com>',
      'carol@ext.com',
    ]);
  });

  it('reads the headers by the host’s address rule when it is given one', () => {
    const rules = { ...defaultAddressRules, isValid: (address: string) => address.endsWith('.com') };
    expect(replyEnvelope(MESSAGE, 'reply-all', { self, addressRules: rules }).cc).toEqual([
      '"Miller, Bob" <bob@ext.com>',
      'carol@ext.com',
    ]);
    expect(replyEnvelope({ from: 'Hong <hong@iusta.io>' }, 'reply', { addressRules: rules }).to).toEqual([]);
  });

  it('a forward addresses nobody yet and says Fwd:', () => {
    expect(replyEnvelope(MESSAGE, 'forward', { self })).toEqual({
      to: [],
      cc: [],
      subject: 'Fwd: Contract draft',
    });
  });

  it('drops what is no mailbox — a group’s empty list, a bare name', () => {
    const message = { ...MESSAGE, cc: 'undisclosed-recipients:;, Nobody' };
    expect(replyEnvelope(message, 'reply-all', { self }).cc).toEqual([
      '"Miller, Bob" <bob@ext.com>',
    ]);
  });

  describe('subject', () => {
    const subject = (text: string, kind: ReplyKind = 'reply', labels?: ComposeSeedLabels) =>
      replyEnvelope({ subject: text }, kind, { labels }).subject;
    const german: ComposeSeedLabels = { re: 'AW: ', fwd: 'WG: ' };

    it('never doubles a prefix, whatever its case', () => {
      expect(subject('RE: Contract draft')).toBe('Re: Contract draft');
      expect(subject('re: Contract draft')).toBe('Re: Contract draft');
    });

    it('replaces a same-family prefix from another language instead of stacking', () => {
      expect(subject('Re: Contract draft', 'reply', german)).toBe('AW: Contract draft');
      expect(subject('Antw: Contract draft')).toBe('Re: Contract draft');
      expect(subject('WG: Contract draft', 'forward')).toBe('Fwd: Contract draft');
    });

    it('collapses a whole run, numbered repeats included', () => {
      expect(subject('AW: Re: RE: Contract draft', 'reply', german)).toBe('AW: Contract draft');
      expect(subject('Re[2]: Contract draft', 'reply', german)).toBe('AW: Contract draft');
    });

    it('keeps the other family: a forwarded reply stays marked as both', () => {
      expect(subject('AW: Contract draft', 'forward', german)).toBe('WG: AW: Contract draft');
      expect(subject('WG: Contract draft', 'reply-all', german)).toBe('AW: WG: Contract draft');
    });

    it('leaves subjects that only start with those letters alone', () => {
      expect(subject('AWS: outage report', 'reply', german)).toBe('AW: AWS: outage report');
      expect(subject('Read: receipt')).toBe('Re: Read: receipt');
      expect(subject('WG-Zimmer gesucht', 'forward', german)).toBe('WG: WG-Zimmer gesucht');
    });

    it('knows the host’s own prefix, whatever the language', () => {
      const swedish: ComposeSeedLabels = { re: 'SV: ', fwd: 'VB: ' };
      expect(subject('SV: Re: Avtal', 'reply', swedish)).toBe('SV: Avtal');
      expect(subject('VB: Avtal', 'forward', swedish)).toBe('VB: Avtal');
    });
  });
});

/** What a German host passes — core's words: "Am {date} schrieb {from}:". */
const GERMAN: ComposeSeedLabels = {
  attribution: ({ from, date }) =>
    from && date ? `Am ${date} schrieb ${from}:` : from ? `${from} schrieb:` : null,
  forwarded: '---------- Weitergeleitete Nachricht ---------',
  from: 'Von',
  date: 'Datum',
  subject: 'Betreff',
  to: 'An',
};

describe('replyDocument labels', () => {
  it('words the attribution with the host’s function, from what is known', () => {
    expect(replyDocument({ text: 'x', from: 'Jane', date: '12.08.2026' }, { labels: GERMAN })).toContain(
      '<div>Am 12.08.2026 schrieb Jane:</div>',
    );
    expect(replyDocument({ text: 'x', from: 'Jane' }, { labels: GERMAN })).toContain(
      '<div>Jane schrieb:</div>',
    );
  });

  it('leaves the line out when the function answers nothing', () => {
    expect(replyDocument({ text: 'x', date: '12.08.2026' }, { labels: GERMAN })).toBe(
      '<div><br></div><blockquote style="margin: 0px; padding-left: 12px; border-left: 2px solid rgb(224, 224, 224);"><div>x</div></blockquote>',
    );
  });

  it('hands the function the date already formatted for the locale', () => {
    const date = new Date(2026, 7, 12, 9, 14);
    const expected = new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
    expect(
      replyDocument({ text: 'x', from: 'Jane', date }, { locale: 'de-DE', labels: GERMAN }),
    ).toContain(`<div>Am ${expected} schrieb Jane:</div>`);
  });

  it('takes the answer as text, never as markup', () => {
    const html = replyDocument(
      { text: 'x', from: 'Jane' },
      { labels: { attribution: ({ from }) => `<b>${from}</b> wrote:` } },
    );
    expect(html).toContain('<div>&lt;b&gt;Jane&lt;/b&gt; wrote:</div>');
    expect(canonical(html)).toBe(html);
  });
});
