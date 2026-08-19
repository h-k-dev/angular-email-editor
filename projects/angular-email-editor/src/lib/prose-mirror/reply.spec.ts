import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { lintHTML } from './html-source';
import { emailExtensions } from './extensions/kits';
import { forwardDocument, replyDocument } from './reply';

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
