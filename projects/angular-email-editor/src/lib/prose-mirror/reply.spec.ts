import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { lintHTML } from './html-source';
import { emailExtensions } from './extensions/kits';
import {
  forwardDocument,
  importLoss,
  importedDocument,
  replyDocument,
  toInboundMessage,
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
        '<blockquote><div>Hello there</div><div><br></div><div>Best, Jane</div></blockquote>',
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
    expect(html).toContain('<blockquote><div>Word text</div></blockquote>');
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
    expect(html).toContain('<blockquote><div>Sure!</div><blockquote><div>Original</div></blockquote></blockquote>');
    expect(html).not.toContain('gmail_quote');
    expect(canonical(html)).toBe(html);
  });

  it('falls back to the text/plain part, one paragraph per line', () => {
    const html = replyDocument({ text: 'line one\n\nline two', from: 'Jane' });
    expect(html).toContain(
      '<blockquote><div>line one</div><div><br></div><div>line two</div></blockquote>',
    );
  });

  it('degrades the attribution gracefully with partial data', () => {
    expect(replyDocument({ text: 'x', from: 'Jane' })).toContain('<div>Jane wrote:</div>');
    expect(replyDocument({ text: 'x', date: 'yesterday' })).toContain('<div>On yesterday:</div>');
    // No metadata: the quote stands on its own, no attribution paragraph.
    expect(replyDocument({ text: 'x' })).toBe('<div><br></div><blockquote><div>x</div></blockquote>');
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
    expect(html).toBe('<div><br></div><blockquote><div><br></div></blockquote>');
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
      to: [
        { name: 'You', address: 'you@example.com' },
        { address: 'ops@example.com' },
      ],
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
    expect(replyDocument(inbound)).toContain('<blockquote><div>hi</div></blockquote>');
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
    expect(importLoss({ html: '<div><font color="#004a77">x</font></div>' }).removedElements).toBe(0);
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
});
