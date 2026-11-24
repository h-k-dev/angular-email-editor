import { laysItselfOut } from './layout';
import { foldQuoted, splitQuoted } from './quoted';
import { renderDawn } from './render';

const whole = (body: string) =>
  `<!DOCTYPE html><html><head><style>p{margin:0}</style></head><body>${body}</body></html>`;

describe('splitQuoted', () => {
  it('tells a Gmail answer from the mail it quotes, attribution and all', () => {
    const own = '<div dir="ltr">Works for me.</div>';
    const quote =
      '<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Mon, Aug 17, 2026 at 9:00 AM Sam &lt;sam@example.com&gt; wrote:<br></div>' +
      '<blockquote class="gmail_quote"><div>First draft attached.</div></blockquote></div>';
    expect(splitQuoted(`${own}<br>${quote}`)).toEqual({ body: own, quoted: `<br>${quote}` });
    // The quote in the text's own wrapper, as Gmail writes it from a phone.
    expect(splitQuoted(`<div dir="auto">Works for me.<br>${quote}</div>`)).toEqual({
      body: '<div dir="auto">Works for me.</div>',
      quoted: `<br>${quote}`,
    });
  });

  it('takes everything under Outlook’s header: the rule, From / Sent / To, the answered mail', () => {
    const history =
      '<div id="appendonsend"></div><hr style="display:inline-block;width:98%">' +
      '<div id="divRplyFwdMsg" dir="ltr"><b>From:</b> Sam<br><b>Sent:</b> Monday<br><b>Subject:</b> Agenda</div>' +
      '<div>First draft attached.</div><blockquote>A quote of Sam’s own.</blockquote>';
    expect(splitQuoted(`<div>Thanks, Sam.</div>${history}`)).toEqual({
      body: '<div>Thanks, Sam.</div>',
      quoted: history,
    });
  });

  it('takes Word’s header the same way: a line over From, inside the section', () => {
    const header =
      '<div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm">' +
      '<p class="MsoNormal"><b>From:</b> Sam</p></div></div>';
    const { body, quoted } = splitQuoted(
      whole(
        `<div class="WordSection1"><p class="MsoNormal">Thanks.</p>${header}<p class="MsoNormal">First draft.</p></div>`,
      ),
    );
    expect(quoted).toBe(`${header}<p class="MsoNormal">First draft.</p>`);
    // A whole document stays one, its head with it.
    expect(body).toContain('<style>p{margin:0}</style>');
    expect(body).toContain('<div class="WordSection1"><p class="MsoNormal">Thanks.</p></div>');
  });

  it('takes Apple Mail’s and Thunderbird’s cite, with the line over it', () => {
    const apple =
      '<div><br><blockquote type="cite"><div>On 18 Aug 2026, at 10:12, Monika wrote:</div><br><div>Fine by me.</div></blockquote></div>';
    expect(splitQuoted(whole(`<div>Booked.</div>${apple}`)).quoted).toBe(apple);

    const thunderbird =
      '<div class="moz-cite-prefix">Am 18.08.26 um 10:12 schrieb Monika:<br></div>' +
      '<blockquote type="cite" cite="mid:a@example.com"><p>Fine by me.</p></blockquote>';
    expect(splitQuoted(`<p>Gebucht.</p>${thunderbird}`)).toEqual({
      body: '<p>Gebucht.</p>',
      quoted: thunderbird,
    });
  });

  it('takes a plain quote only under an attribution line', () => {
    const quote = '<blockquote>First draft attached.</blockquote>';
    expect(splitQuoted(`<p>Fine.</p><p>On Monday, Sam wrote:</p>${quote}`).quoted).toBe(
      `<p>On Monday, Sam wrote:</p>${quote}`,
    );
    // A newsletter's closing pull quote is its own.
    expect(splitQuoted(`<p>Our founder said:</p>${quote}`).quoted).toBe('');
  });

  it('leaves a message as it came where the quote is not a trailing history', () => {
    const quote = '<blockquote type="cite">When do we meet?</blockquote>';
    // Answered line by line: the quote is the message.
    const inline = `<div>See below.</div>${quote}<div>At ten.</div>`;
    expect(splitQuoted(inline)).toEqual({ body: inline, quoted: '' });
    // Nothing but the quote — a bare forward.
    const bare = `<br><div class="gmail_quote">${quote}</div>`;
    expect(splitQuoted(bare)).toEqual({ body: bare, quoted: '' });
    // No quote at all.
    expect(splitQuoted('<p>Hello</p>')).toEqual({ body: '<p>Hello</p>', quoted: '' });
  });

  it('reads the outermost history: a quote’s own quotes are its', () => {
    const { body, quoted } = splitQuoted(
      '<div>Works for me.</div><blockquote class="gmail_quote"><div>On Monday, Sam wrote:</div>' +
        '<blockquote class="gmail_quote"><div>First draft.</div></blockquote></blockquote>',
    );
    expect(body).toBe('<div>Works for me.</div>');
    expect(quoted).toContain('First draft.');
  });
});

// A quoted mail's header written out as text, in a block of its own: no
// class, no id, no rule — WEB.DE's and GMX's apps, Outlook's plain text.
describe('splitQuoted, on a header written out as text', () => {
  // As WEB.DE's app answers: its own text and the attribution line in one
  // block (no colon at its end), the quoted mail in the next — its header a
  // block of its own, the mail under it.
  const own =
    '<div><p>Dear Ms Novak,</p><p>thank you for the call yesterday.</p><p>Kind regards<br>Lena</p><br>Sent with the WEB.DE Mail App<br><br>On 17.11.26 at 11:19 Novak Legal wrote<br><br></div>';
  const header =
    '<div>From: "Novak Legal" &lt;office@novak.example&gt;<br>Date: 17 November 2026<br>To: lena@example.com<br>Cc: <br>Subject: Your case 2874/24</div>';
  const mail =
    '<div class="WordSection1"><p class="MsoNormal">Dear Ms Weber,</p><p>please find the offer attached.</p></div>';
  const history = `<div>${header}<p></p>${mail}</div>`;

  it('takes the header block and the mail under it, the answer kept', () => {
    expect(splitQuoted(`<div id="message">${own}${history}</div>`)).toEqual({
      body: `<div id="message">${own}</div>`,
      quoted: history,
    });
  });

  it('reads the header in the languages it is written in', () => {
    const german =
      '<div>Von: "Novak Legal" &lt;office@novak.example&gt;<br>Datum: 17. November 2026<br>An: lena@example.com<br>Betreff: Ihre Angelegenheit</div>';
    // An attribution on a line of its own over it (no colon, as WEB.DE
    // writes it) goes with it.
    const attribution = '<p>Am 17.11.26 um 11:19 schrieb Kanzlei Novak</p>';
    expect(
      splitQuoted(`<p>Danke.</p>${attribution}${german}<p>Sehr geehrte Frau Weber,</p>`).quoted,
    ).toBe(`${attribution}${german}<p>Sehr geehrte Frau Weber,</p>`);
    // A rule over it, and the rule with it.
    const romanian =
      '<div>De la: Ana Popescu<br>Data: 17 noiembrie 2026<br>Către: ioana@example.com<br>Subiect: Contract</div>';
    expect(splitQuoted(`<p>Mulțumesc.</p><hr>${romanian}<p>Bună ziua,</p>`).quoted).toBe(
      `<hr>${romanian}<p>Bună ziua,</p>`,
    );
  });

  it('takes Outlook’s plain-text rule of underscores as a separator', () => {
    const plain =
      '<div>________________________________<br>From: Sam Lee<br>Sent: Monday, 17 August 2026 09:00<br>To: Lena<br>Subject: Agenda</div>';
    expect(splitQuoted(`<p>Fine.</p>${plain}<p>Draft attached.</p>`).quoted).toBe(
      `${plain}<p>Draft attached.</p>`,
    );
  });

  it('is no header where no reply’s mark stands over it — a notification’s fields', () => {
    const fields =
      '<div>From: Jane Doe &lt;jane@example.com&gt;<br>Date: 17 Nov 2026<br>To: support@acme.example<br>Subject: Pricing</div>';
    const ticket = `<p>New ticket #4411:</p>${fields}<p>How much is Pro?</p><p>Reply in the portal.</p>`;
    expect(splitQuoted(ticket)).toEqual({ body: ticket, quoted: '' });
    expect(foldQuoted(ticket, { label: 'Quoted text' })).toBe(ticket);
    // Nested in a wrapper, the line over the wrapper is still no attribution.
    const wrapped = `<p>New ticket #4411:</p><div>${fields}<p>How much is Pro?</p></div>`;
    expect(splitQuoted(wrapped).quoted).toBe('');
  });

  it('takes Outlook’s plain separator over the header with it', () => {
    const plain =
      '<div>-----Original Message-----<br>From: Sam Lee<br>Sent: Monday, 17 August 2026 09:00<br>To: Lena<br>Subject: Agenda</div>';
    expect(splitQuoted(`<p>Fine.</p>${plain}<p>Draft attached.</p>`).quoted).toBe(
      `${plain}<p>Draft attached.</p>`,
    );
    // Separator labels with internal hyphens (e.g. German "E-Mail").
    const hyphenated =
      '<div>-----Ursprüngliche E-Mail-----<br>Von: Kanzlei Novak<br>Datum: 17. November 2026<br>Betreff: Akte</div>';
    expect(splitQuoted(`<p>Danke.</p>${hyphenated}<p>Text.</p>`).quoted).toBe(
      `${hyphenated}<p>Text.</p>`,
    );
  });

  it('marks only plain-text headers in the fold, never client headers, boxes or inline elements', () => {
    const fold = (html: string) =>
      new DOMParser().parseFromString(foldQuoted(html, { label: 'Quoted text' }), 'text/html');

    const webde = fold(`<div id="message">${own}${history}</div>`);
    const marked = Array.from(webde.querySelectorAll('[data-dawn-quoted-header]'));
    expect(marked.map((element) => element.textContent?.trim().slice(0, 5))).toEqual(['From:']);
    expect(marked[0]?.closest('details[data-dawn-quoted]')).not.toBeNull();

    // Inline wrapper inside a plain-text header: marks the block container, not the `<span>`.
    const inlineWrapped = fold(
      '<p>Danke.<br>Am Montag schrieb Kanzlei:</p><div><div><span>Von: Kanzlei<br>Datum: 17. Nov<br>An: lena@example.com<br>Betreff: Akte</span></div><p>Hallo,</p></div>',
    );
    const wrappedMarked = Array.from(inlineWrapped.querySelectorAll('[data-dawn-quoted-header]'));
    expect(wrappedMarked.map((el) => el.tagName)).toEqual(['DIV']);

    // Inline separator (`<b>-----Original Message-----</b>`): marks the block container, not `<b>`.
    const inlineSep = fold(
      '<p>Fine.</p><div><b>-----Original Message-----</b><br>From: Sam<br>Sent: Mon<br>To: Lena<br>Subject: Agenda</div><p>Draft.</p>',
    );
    const inlineSepMarked = Array.from(inlineSep.querySelectorAll('[data-dawn-quoted-header]'));
    expect(inlineSepMarked.map((el) => el.tagName)).toEqual(['DIV']);

    // Separator in its own sibling block over the fields: marks the separator, not the fields.
    const siblingSep = fold(
      '<p>Fine.</p><div><div>-----Original Message-----</div><div>From: Sam<br>Sent: Mon<br>To: Lena<br>Subject: Agenda</div><p>Draft.</p></div>',
    );
    const sepMarked = Array.from(siblingSep.querySelectorAll('[data-dawn-quoted-header]'));
    expect(sepMarked.map((el) => el.textContent?.trim())).toEqual(['-----Original Message-----']);

    // An attribution in its own block over the fields: in the fold, and the gap over it.
    const attributed = fold(
      '<p>Danke.</p><p>Am Montag schrieb Kanzlei:</p><div>Von: Kanzlei<br>Datum: 17. Nov<br>An: Lena<br>Betreff: Akte</div><p>Hallo,</p>',
    );
    const attributedMarked = Array.from(attributed.querySelectorAll('[data-dawn-quoted-header]'));
    expect(attributedMarked.map((el) => el.textContent?.trim())).toEqual([
      'Am Montag schrieb Kanzlei:',
    ]);
    expect(attributedMarked[0]?.parentElement?.tagName).toBe('DETAILS');

    // Already-known client headers and boxed forwards (Gmail `.gmail_attr`, Apple Mail
    // `<blockquote type="cite">`, Outlook `#divRplyFwdMsg`, Word's ruled header) never get
    // `data-dawn-quoted-header`.
    const gmailForward = fold(
      '<div>Fine.</div><div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>From: Sam<br>Date: Mon<br>Subject: Agenda<br>To: Lena</div><div>Draft.</div></div>',
    );
    expect(gmailForward.querySelector('[data-dawn-quoted-header]')).toBeNull();

    const appleForward = fold(
      '<div>See below.</div><blockquote type="cite"><div>From: Sam<br>Date: Mon<br>To: Lena<br>Subject: Agenda</div><div>Draft.</div></blockquote>',
    );
    expect(appleForward.querySelector('[data-dawn-quoted-box]')?.tagName).toBe('BLOCKQUOTE');
    expect(appleForward.querySelector('[data-dawn-quoted-header]')).toBeNull();

    const outlookWithFont = fold(
      '<div>Thanks.</div><hr><div id="divRplyFwdMsg"><font><b>From:</b> Sam<br><b>Sent:</b> Mon<br><b>To:</b> Lena<br><b>Subject:</b> Agenda</font></div><div>Draft.</div>',
    );
    expect(outlookWithFont.querySelector('[data-dawn-quoted-header]')).toBeNull();

    const outlookPlain = fold(
      '<div>Thanks.</div><hr><div id="divRplyFwdMsg"><b>From:</b> Sam<br><b>Sent:</b> Mon<br><b>Subject:</b> Agenda</div><div>Draft.</div>',
    );
    expect(outlookPlain.querySelector('[data-dawn-quoted-header]')).toBeNull();

    const wordHeader = fold(
      '<p>Thanks.</p><div style="border-top: solid #E1E1E1 1.0pt"><p><b>From:</b> Sam<br><b>Sent:</b> Mon<br><b>Subject:</b> Agenda</p></div><p>Draft.</p>',
    );
    expect(wordHeader.querySelector('[data-dawn-quoted-header]')).toBeNull();
  });

  it('never folds wrapped forwards that have reply text after them', () => {
    const gmailInline =
      '<div>See the forward below:</div>' +
      '<div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>From: Sam<br>Date: Mon<br>To: Lena<br>Subject: Agenda</div><div>Draft.</div></div>' +
      '<div>What do you think?</div>';
    expect(splitQuoted(gmailInline)).toEqual({ body: gmailInline, quoted: '' });

    // Even when wrapped in an extra `<div>`.
    const wrappedGmailInline =
      '<div>See below:</div>' +
      '<div><div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>From: Sam<br>Date: Mon<br>To: Lena<br>Subject: Agenda</div><div>Draft.</div></div></div>' +
      '<div>My reply underneath.</div>';
    expect(splitQuoted(wrappedGmailInline)).toEqual({ body: wrappedGmailInline, quoted: '' });

    const appleInline =
      '<div>See below:</div>' +
      '<blockquote type="cite"><div>From: Sam<br>Date: Mon<br>To: Lena<br>Subject: Agenda</div><div>Draft.</div></blockquote>' +
      '<div>My reply underneath.</div>';
    expect(splitQuoted(appleInline)).toEqual({ body: appleInline, quoted: '' });
  });

  it('ignores <style> inside a plain-text header block when detecting and measuring it', () => {
    const bigCss = `.x { color: red; /* ${'a'.repeat(1200)} */ }`;
    const styledHeader = `<div><style>${bigCss}</style>Von: Kanzlei Novak<br>Datum: 17. November 2026<br>An: lena@example.com<br>Betreff: Akte</div>`;
    expect(
      splitQuoted(`<p>Danke.<br>Am Montag schrieb Kanzlei Novak:</p>${styledHeader}<p>Sehr geehrte Frau Weber,</p>`)
        .quoted,
    ).toBe(`${styledHeader}<p>Sehr geehrte Frau Weber,</p>`);
  });

  it('never lets an unfoldable cell or list item block a real quote further down', () => {
    const realQuote = '<div class="gmail_quote">Earlier message.</div>';
    const withCell =
      '<p>Summary:</p>' +
      '<table><tbody><tr><td>From: Sam<br>Date: Mon<br>To: Lena<br>Subject: Ticket</td></tr></tbody></table>' +
      realQuote;
    expect(splitQuoted(withCell).quoted).toBe(realQuote);

    const withQuotedCell =
      '<p>Summary:</p>' +
      '<table><tbody><tr><td class="gmail_quote">Cell quote</td></tr></tbody></table>' +
      realQuote;
    expect(splitQuoted(withQuotedCell).quoted).toBe(realQuote);

    const withListItem =
      '<p>Summary:</p>' +
      '<ul><li>From: Sam<br>Date: Mon<br>To: Lena<br>Subject: Ticket</li></ul>' +
      realQuote;
    expect(splitQuoted(withListItem).quoted).toBe(realQuote);
  });

  // Each under a reply's mark (a rule), so the guard named is what turns
  // it down, not the missing mark.
  it('is no header without all four fields (when unseparated), nor a block as long as a mail', () => {
    const noSubject = '<p>Hi,</p><hr><div>From: our team<br>Date: Mon<br>To: you<br>With love</div>';
    expect(splitQuoted(noSubject).quoted).toBe('');
    // Contact-form / ticket summaries missing Date or To.
    const twoLineForm =
      '<p>New inquiry:</p><hr><div>From: Jane Doe<br>Subject: Pricing</div><p>How much is Pro?</p>';
    expect(splitQuoted(twoLineForm).quoted).toBe('');
    const threeLineNoTo =
      '<p>New ticket:</p><hr><div>From: Jane Doe<br>Date: 17 Nov 2026<br>Subject: Pricing</div><p>How much is Pro?</p>';
    expect(splitQuoted(threeLineNoTo).quoted).toBe('');
    const threeLineNoDate =
      '<p>New ticket:</p><hr><div>From: Jane Doe<br>To: Support<br>Subject: Pricing</div><p>How much is Pro?</p>';
    expect(splitQuoted(threeLineNoDate).quoted).toBe('');
    const long = `<p>Hi,</p><hr><div>From: our team<br>Date: Today<br>To: you<br>Subject: News<br>${'More news. '.repeat(120)}</div>`;
    expect(splitQuoted(long).quoted).toBe('');
    // A forward and nothing else: no answer of its own to keep.
    expect(splitQuoted(`<hr>${header}${mail}`).quoted).toBe('');
  });

  it('finds the reply’s mark over the wrappers a header opens, and takes it along', () => {
    const fields = '<div>Von: Kanzlei<br>Datum: 17. Nov<br>An: Lena<br>Betreff: Akte</div>';
    const attribution = '<p>Am Montag schrieb Kanzlei:</p>';
    const separator = '<div>-----Original Message-----</div>';
    // The mail too long for its wrapper to be the header: the inner block is.
    const longMail = `<p>${'Sehr geehrte Frau Weber. '.repeat(60)}</p>`;
    for (const mark of [attribution, separator]) {
      const history = `${mark}<div>${fields}${longMail}</div>`;
      expect(splitQuoted(`<p>Danke.</p>${history}`)).toEqual({
        body: '<p>Danke.</p>',
        quoted: history,
      });
    }
    // Short: the wrapper and the block in it are both headers; only the mark
    // gets the gap, never the fields under it too.
    const folded = new DOMParser().parseFromString(
      foldQuoted(`<p>Danke.</p>${attribution}<div>${fields}<p>Hallo,</p></div>`, {
        label: 'Quoted text',
      }),
      'text/html',
    );
    const marked = Array.from(folded.querySelectorAll('[data-dawn-quoted-header]'));
    expect(marked.map((el) => el.textContent?.trim())).toEqual(['Am Montag schrieb Kanzlei:']);
  });

  it('takes a rule in a wrapper of its own for a reply’s mark', () => {
    const fields = '<div>Von: Kanzlei<br>Datum: 17. Nov<br>An: Lena<br>Betreff: Akte</div>';
    expect(splitQuoted(`<p>Danke.</p><div><hr></div>${fields}<p>Hallo,</p>`).quoted).toBe(
      `<div><hr></div>${fields}<p>Hallo,</p>`,
    );
  });
});

describe('splitQuoted, on what is not quite a history', () => {
  const quote = '<blockquote>First draft attached.</blockquote>';

  it('reads an attribution in the word order its language writes it in', () => {
    // German, Dutch and Swedish name the sender after the verb.
    for (const line of [
      'Am 18.08.26 um 10:12 schrieb Monika Weber &lt;monika@example.com&gt;:',
      'Op 18 aug. 2026 om 10:12 schreef Jan:',
      'Den 18 aug. 2026 kl. 10:12 skrev Anna:',
      // …or the time after the verb, as Outlook and Thunderbird write it.
      'Monika Weber schrieb am 18.08.2026 um 10:12:',
      'Jan schreef op 18 aug. 2026 om 10:12:',
      'Le 18 août 2026 à 10:12, Monika a écrit :',
      '2026年8月18日(火) 10:12 Monika &lt;monika@example.com&gt;:',
      'Monikaさんは書きました:',
    ]) {
      expect(splitQuoted(`<p>Fine.</p><div>${line}</div>${quote}`).quoted, line).toBe(
        `<div>${line}</div>${quote}`,
      );
    }
  });

  it('takes the verb as a word of its own', () => {
    for (const line of ['Then he rewrote:', 'Wie sie es beschrieb:']) {
      expect(splitQuoted(`<p>News.</p><p>${line}</p>${quote}`).quoted, line).toBe('');
    }
  });

  it('never folds the answer’s own text with the line under it', () => {
    const cite = '<blockquote type="cite">First draft.</blockquote>';
    const answer = '<div>Thanks, sounds good.<br>On Mon, Sam wrote:</div>';
    // The quote folds; the block that holds the answer stays in sight.
    expect(splitQuoted(`<p>Hi Sam,</p>${answer}${cite}`)).toEqual({
      body: `<p>Hi Sam,</p>${answer}`,
      quoted: cite,
    });
    // Without a mark of its own, such a quote is no history at all.
    expect(splitQuoted(`<p>Hi Sam,</p>${answer}${quote}`).quoted).toBe('');
    // Each line a block of its own, as Gmail and Apple Mail write them; a
    // signature's picture over the line.
    for (const own of [
      '<div>Thanks, sounds good.<div>On Mon, Sam wrote:</div></div>',
      '<div><img src="sig.png"><br>On Mon, Sam wrote:</div>',
    ]) {
      expect(splitQuoted(`<p>Hi Sam,</p>${own}${cite}`), own).toEqual({
        body: `<p>Hi Sam,</p>${own}`,
        quoted: cite,
      });
    }
  });

  it('looks for the line over a quote no further than a rule', () => {
    expect(splitQuoted(`<p>On Monday, Sam wrote:</p><hr>${quote}`).quoted).toBe('');
  });

  it('folds nothing away for a mark with nothing in it', () => {
    for (const empty of [
      '<div class="gmail_quote"></div>',
      '<blockquote type="cite"><br></blockquote>',
    ]) {
      expect(splitQuoted(`<p>Hi</p>${empty}`).quoted, empty).toBe('');
    }
  });

  it('leaves Outlook’s append mark alone where no answer follows it', () => {
    const letter = '<p>Hi team</p><div id="appendonsend"></div><p>Kind regards, Monika</p>';
    expect(splitQuoted(letter)).toEqual({ body: letter, quoted: '' });
  });

  it('tells Word’s header from a newsletter’s divider by its field names', () => {
    const divider =
      '<p>Top story</p><div style="border-top: solid #e1e1e1 1px">More news</div><p>Footer</p>';
    expect(splitQuoted(divider).quoted).toBe('');
    // Bold in a receipt's section is no field name: a sentence, or no colon.
    const receipt =
      '<p>Thanks for your order.</p><div style="border-top:solid #E1E1E1 1.0pt"><p><b>Order total</b> 42 €</p><p><strong>Ships within two business days, as always:</strong></p></div><p>Footer</p>';
    expect(splitQuoted(receipt).quoted).toBe('');
    // Word's header written back in the usual order still is one.
    const header =
      '<div style="border-top: 1pt solid #e1e1e1"><p><b>Von:</b> Sam</p></div><p>First draft.</p>';
    expect(splitQuoted(`<p>Danke.</p>${header}`).quoted).toBe(header);
  });

  it('takes apart only what it would fold: never a table cell out of its row', () => {
    const row =
      '<p>Fine.</p><table><tbody><tr><td>Total</td><td class="gmail_quote">On Monday, Sam wrote: q</td></tr></tbody></table>';
    expect(splitQuoted(row)).toEqual({ body: row, quoted: '' });
    expect(foldQuoted(row, { label: 'Quoted text' })).toBe(row);
  });

  it('passes a quote answered in the text for the history at the end', () => {
    const history = '<div class="gmail_quote">The mail answered.</div>';
    expect(
      splitQuoted(`<p>As Jane wrote:</p><blockquote>q</blockquote><p>Agreed.</p>${history}`).quoted,
    ).toBe(history);
  });

  it('takes Yahoo’s and Proton’s wrappers', () => {
    for (const wrapper of ['yahoo_quoted', 'protonmail_quote']) {
      const history = `<div class="${wrapper}"><div>On Monday, Sam wrote:</div><blockquote>Draft.</blockquote></div>`;
      expect(splitQuoted(`<div>Fine.</div>${history}`).quoted, wrapper).toBe(history);
    }
  });
});

describe('foldQuoted', () => {
  const answer =
    '<div>Works for me.</div><blockquote class="gmail_quote"><div>First draft.</div></blockquote>';
  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

  it('folds the history behind a ⋯, closed, named for assistive tech', () => {
    const doc = parse(foldQuoted(answer, { label: 'Quoted text' }));
    const fold = doc.querySelector('details[data-dawn-quoted]')!;

    expect(fold.hasAttribute('open')).toBe(false);
    expect(fold.previousElementSibling?.textContent).toBe('Works for me.');
    expect(fold.querySelector('blockquote')?.textContent).toBe('First draft.');
    const toggle = fold.firstElementChild!;
    expect(toggle.tagName).toBe('SUMMARY');
    expect(toggle.textContent).toBe('⋯');
    expect(toggle.getAttribute('aria-label')).toBe('Quoted text');
  });

  it('folds where the history starts, inside the text’s own wrapper', () => {
    const doc = parse(
      foldQuoted(
        `<div dir="auto">Works for me.<br><div class="gmail_quote">First draft.</div></div>`,
        {
          label: 'Quoted text',
        },
      ),
    );
    expect(doc.querySelector('div[dir] > details > .gmail_quote')).not.toBeNull();
  });

  // A `<details>` beside a row or a list's item is moved out by the parser,
  // empty, and the quote left in sight.
  it('folds inside the cell or the item the quote is in, never beside it', () => {
    const reparsed = (html: string) =>
      parse(parse(foldQuoted(html, { label: 'Quoted text' })).body.innerHTML);
    const table = reparsed(
      '<table><tbody><tr><td>Reply</td></tr><tr><td><div class="gmail_quote">old</div></td></tr></tbody></table>',
    );
    expect(table.querySelector('tr:last-child > td > details > .gmail_quote')?.textContent).toBe(
      'old',
    );
    const list = reparsed(
      '<ul><li>Reply</li><li><blockquote type="cite">old</blockquote></li></ul>',
    );
    expect(list.querySelector('ul > li:last-child > details > blockquote')).not.toBeNull();
  });

  it('folds nothing where the quote is the cell or the item itself', () => {
    for (const html of [
      '<table><tbody><tr><td>Thanks</td></tr><tr><td style="border-top: solid #e1e1e1 1pt"><b>From:</b> Sam</td></tr></tbody></table>',
      '<ul><li>Thanks</li><li class="gmail_quote">old</li></ul>',
    ]) {
      expect(foldQuoted(html, { label: 'Quoted text' }), html).toBe(html);
    }
  });

  it('folds Outlook’s history from its rule on, and a whole document’s in its body', () => {
    const outlook = parse(
      foldQuoted(
        '<div>Thanks.</div><div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>From:</b> Sam</div><div>Draft.</div>',
        { label: 'Quoted text' },
      ),
    );
    expect([...outlook.querySelector('details')!.children].map((el) => el.tagName)).toEqual([
      'SUMMARY',
      'STYLE',
      'DIV',
      'HR',
      'DIV',
      'DIV',
    ]);

    const apple = foldQuoted(
      whole('<div>Booked.</div><div><br><blockquote type="cite">Fine by me.</blockquote></div>'),
      { label: 'Quoted text' },
    );
    expect(apple).toContain('<style>p{margin:0}</style>');
    expect(parse(apple).querySelector('body > details blockquote')?.textContent).toBe(
      'Fine by me.',
    );
  });

  it('draws a thin pill with a 24px touch target, with no inline style locking consumers out', () => {
    const doc = parse(foldQuoted(answer, { label: 'Quoted text' }));
    const toggle = doc.querySelector('summary')!;
    const css = doc.querySelector('details > style')?.textContent ?? '';
    expect(toggle.hasAttribute('style')).toBe(false);
    expect(css).toContain('font: 700 16px/16px Arial, sans-serif');
    expect(css).toContain('min-width: 28px');
    expect(css).toContain(
      'details[data-dawn-quoted] > summary::after { content: ""; position: absolute; inset: -4px 0; }',
    );
  });

  it('supports headless output (style: false) and custom consumer CSS overrides', () => {
    const headless = parse(foldQuoted(answer, { label: 'Quoted text', style: false }));
    expect(headless.querySelector('details[data-dawn-quoted] > style')).toBeNull();
    expect(headless.querySelector('summary')?.hasAttribute('style')).toBe(false);
    expect(headless.querySelector('details > blockquote')?.textContent).toBe('First draft.');

    const themed = parse(
      foldQuoted(answer, {
        label: 'Quoted text',
        style: ':root { --dawn-quoted-stem: #6750a4; }',
      }),
    );
    const css = themed.querySelector('details > style')?.textContent ?? '';
    expect(css).toContain('details[data-dawn-quoted] > summary');
    expect(css).toContain(':root { --dawn-quoted-stem: #6750a4; }');
  });

  it('leaves a message that quotes nothing exactly as it came', () => {
    const letter = whole('<p>Hello</p>');
    expect(foldQuoted(letter, { label: 'Quoted text' })).toBe(letter);
    expect(foldQuoted('<p>Hello</p>', { label: 'Quoted text' })).toBe('<p>Hello</p>');
  });
});

// A real Gmail answer to an answer to an answer: each quote holds the one
// before it — one history, folded once.
describe('foldQuoted, on a history seven quotes deep', () => {
  it('folds the outermost quote alone, every one inside it with it', () => {
    let quote = '<div dir="ltr">First.</div>';
    for (let depth = 0; depth < 7; depth++) {
      quote =
        `<div dir="ltr">Answer ${depth}.</div><br><div class="gmail_quote${depth === 6 ? ' gmail_quote_container' : ''}">` +
        '<div dir="ltr" class="gmail_attr">Am Di., 24. Nov. 2026 um 16:56 Uhr schrieb Alex &lt;alex@example.com&gt;:<br></div>' +
        `<blockquote class="gmail_quote">${quote}</blockquote></div>`;
    }
    const doc = new DOMParser().parseFromString(
      foldQuoted(quote, { label: 'Quoted text' }),
      'text/html',
    );

    expect(doc.querySelectorAll('details[data-dawn-quoted]')).toHaveLength(1);
    expect(doc.body.firstElementChild?.textContent).toBe('Answer 6.');
    expect(doc.querySelector('details')?.querySelectorAll('blockquote')).toHaveLength(7);
    // By style alone: the seven blockquotes stay in the markup, and the
    // fold's sheet draws each message a box using Dawn's own semantic
    // attributes — never client class names like `.gmail_*`.
    const css = doc.querySelector('details > style')?.textContent ?? '';
    expect(css).toContain(
      'details[data-dawn-quoted] blockquote { margin: 0 !important; padding: 0 !important; border: 0 !important; }',
    );
    expect(css).toContain('details[data-dawn-quoted] [data-dawn-quoted-attr]');
    expect(css).toContain('details[data-dawn-quoted] [data-dawn-quoted-box]');
    expect(css).not.toMatch(/gmail|moz-cite|yahoo_quoted|protonmail_quote|divRplyFwdMsg/i);
  });
});

describe('foldQuoted, on a Gmail quote joined to its parent', () => {
  const attr = (who: string) => `<div class="gmail_attr">On Monday, ${who} wrote:<br></div>`;
  const quote = (who: string, inner: string) =>
    `<div class="gmail_quote gmail_quote_container">${attr(who)}<blockquote class="gmail_quote">${inner}</blockquote></div>`;
  const fold = (html: string) =>
    new DOMParser().parseFromString(foldQuoted(html, { label: 'Quoted text' }), 'text/html');

  it('joins a forward sent with no word of its own to the message that sent it', () => {
    const forward = '<div class="gmail_quote"><div class="gmail_attr">Forwarded</div>Draft.</div>';
    const doc = fold(`<div>Fine.</div>${quote('Alex', `<div dir="ltr"><br><br>${forward}</div>`)}`);
    expect(doc.querySelectorAll('[data-dawn-quoted-joined]')).toHaveLength(1);
  });

  it('never joins an answer whose words stand straight in Gmail’s wrapper', () => {
    // As Gmail writes it from a phone: the words a text node, no element.
    const mobile = `<div dir="auto">Works for me.<br>${quote('Sam', 'Draft.')}</div>`;
    const doc = fold(`<div>Fine.</div>${quote('Alex', mobile)}`);
    expect(doc.querySelector('[data-dawn-quoted-joined]')).toBeNull();
  });

  it('marks nothing in a fold with no Gmail quote', () => {
    const doc = fold('<div>Fine.</div><div>On Monday, Sam wrote:</div><blockquote>q</blockquote>');
    expect(doc.querySelector('[data-dawn-quoted-joined]')).toBeNull();
  });

  it('keeps Dawn’s fold stylesheet untouched in dark mode and never trips declaresDark', () => {
    const folded = foldQuoted(`<div style="color: #000000">Fine.</div>${quote('Sam', 'Draft.')}`, {
      label: 'Quoted text',
      style: ':root { color-scheme: light dark; }',
    });
    const drawn = new DOMParser().parseFromString(
      renderDawn(folded, { scheme: 'dark' }),
      'text/html',
    );
    const css = drawn.querySelector('details[data-dawn-quoted] > style')?.textContent ?? '';
    expect(css).toContain('rgb(128, 128, 128)');
    expect(css).not.toContain('rgb(153, 153, 153)');
    // The email itself was still drawn dark despite `color-scheme: light dark` in fold CSS.
    expect(drawn.body.firstElementChild?.getAttribute('style')).not.toContain('#000000');
  });

  it('marks plain attributions as two-part box heads, never Outlook headers or client wrapper attributions', () => {
    const afterBlank = fold(
      '<div>Thanks.</div><div><br></div><div>On Monday, Sam wrote:</div><blockquote>Draft.</blockquote>',
    );
    expect(afterBlank.querySelector('[data-dawn-quoted-attr]')?.textContent).toBe(
      'On Monday, Sam wrote:',
    );
    expect(afterBlank.querySelector('[data-dawn-quoted-head]')?.textContent).toBe(
      'On Monday, Sam wrote:',
    );
    expect(afterBlank.querySelector('[data-dawn-quoted-foot]')?.tagName).toBe('BLOCKQUOTE');

    const outlook = fold(
      '<div>Thanks.</div><hr><div id="divRplyFwdMsg"><b>From:</b> Sam</div><blockquote>Quote.</blockquote>',
    );
    expect(outlook.querySelector('[data-dawn-quoted-attr]')).toBeNull();
    expect(outlook.querySelector('[data-dawn-quoted-head]')).toBeNull();

    const yahoo = fold(
      '<div>Thanks.</div><div class="yahoo_quoted"><div>On Monday, Sam wrote:</div><blockquote>Draft.</blockquote></div>',
    );
    expect(yahoo.querySelector('[data-dawn-quoted-attr]')?.textContent).toBe(
      'On Monday, Sam wrote:',
    );
    expect(yahoo.querySelector('[data-dawn-quoted-head]')).toBeNull();
    expect(yahoo.querySelector('[data-dawn-quoted-box]')?.className).toBe('yahoo_quoted');
  });

  it('ignores <style> inside <body> when checking blankness and trailing quotes', () => {
    // A bare forward with a `<style>` in body is still a bare forward — never folded away.
    const bareForward = '<style>.x { color: red; }</style><div class="gmail_quote">Forwarded</div>';
    expect(splitQuoted(bareForward)).toEqual({ body: bareForward, quoted: '' });

    // A trailing `<style>` after a quote does not block folding.
    const trailingStyle = `<div>Fine.</div>${quote('Sam', 'Draft.')}<style>.x{}</style>`;
    expect(splitQuoted(trailingStyle).quoted).toContain('Draft.');

    // A `<style>` before a quote stays with the body.
    const beforeQuote = `<div>Fine.</div><style>.x{}</style>${quote('Sam', 'Draft.')}`;
    expect(splitQuoted(beforeQuote).body).toContain('<style>.x{}</style>');
  });

  it('never mistakes a receipt divider with bold labels for Word’s reply header', () => {
    const receipt =
      '<p>Thanks for your order.</p>' +
      '<div style="border-top: 1px solid #e1e1e1"><p><b>Order ID:</b> 12345<br><b>Total:</b> 42 €</p></div>' +
      '<p>Footer</p>';
    expect(splitQuoted(receipt)).toEqual({ body: receipt, quoted: '' });
  });

  it('never splits an inline wrapped quote that contains an Outlook header', () => {
    const inlineOutlook =
      '<div>See below.</div>' +
      '<div class="yahoo_quoted"><div id="divRplyFwdMsg"><b>From:</b> Sam</div><div>Question?</div></div>' +
      '<div>My answer.</div>';
    expect(splitQuoted(inlineOutlook)).toEqual({ body: inlineOutlook, quoted: '' });
  });

  it('marks only nested boxes that truly trail their parent without a layout barrier', () => {
    const trailing = fold(
      `<div>Fine.</div>${quote('Alex', `<div>Yes.</div>${quote('Sam', 'Draft.')}`)}`,
    );
    expect(trailing.querySelectorAll('[data-dawn-quoted-last]')).toHaveLength(1);

    // Trailing text node after the nested quote.
    const textAfter = fold(
      `<div>Fine.</div>${quote('Alex', `<div>Yes.${quote('Sam', 'Draft.')}And the venue?</div>`)}`,
    );
    expect(textAfter.querySelector('[data-dawn-quoted-last]')).toBeNull();

    // Nested quote wrapped in an extra `<div>` followed by another block.
    const wrappedInline = fold(
      `<div>Fine.</div>${quote('Alex', `<div>Yes.</div><div>${quote('Sam', 'Draft.')}</div><div>And the venue?</div>`)}`,
    );
    expect(wrappedInline.querySelector('[data-dawn-quoted-last]')).toBeNull();

    // Nested quote inside a padded wrapper or table cell.
    const padded = fold(
      `<div>Fine.</div>${quote('Alex', `<div>Yes.</div><div style="padding: 16px">${quote('Sam', 'Draft.')}</div>`)}`,
    );
    expect(padded.querySelector('[data-dawn-quoted-last]')).toBeNull();

    // Zero padding/margin wrapper is no barrier.
    const zeroed = fold(
      `<div>Fine.</div>${quote('Alex', `<div>Yes.</div><div style="margin: 0; padding: 0">${quote('Sam', 'Draft.')}</div>`)}`,
    );
    expect(zeroed.querySelectorAll('[data-dawn-quoted-last]')).toHaveLength(1);
  });

  it('ignores a folded newsletter in laysItselfOut', () => {
    const newsletter =
      '<div>Not for us.</div><hr><div id="divRplyFwdMsg"><b>From:</b> Deals</div>' +
      '<table width="600"><tr><td>Sale</td></tr></table>';
    expect(laysItselfOut(newsletter)).toBe(true);
    expect(laysItselfOut(foldQuoted(newsletter, { label: 'Quoted text' }))).toBe(false);
  });
});
