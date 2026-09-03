import { completionContextAt, formatHTML, lintHTML, openTags, scanHTML } from './html-source';

import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';

const emailSchema = createSchema(emailExtensions);
/** Parse + serialize through the email schema — what the source pane's text becomes. */
const canonicalEmail = (html: string) => serializeToHTML(parseHTML(html, emailSchema), emailSchema);

describe('html-source scanner', () => {
  it('tokenizes tags, attributes and comments', () => {
    const { tokens } = scanHTML('<a href="https://x.io">hi</a><!-- note -->');
    expect(tokens.map((t) => t.type)).toEqual([
      'delimiter', // <
      'tagName', // a
      'attributeName', // href
      'delimiter', // =
      'attributeValue', // "https://x.io"
      'delimiter', // >
      'delimiter', // </
      'tagName', // a
      'delimiter', // >
      'comment', // <!-- note -->
    ]);
  });

  it('treats a lone < in text as text', () => {
    const { tags } = scanHTML('<div>a < b</div>');
    expect(tags.map((t) => `${t.kind}:${t.name}`)).toEqual(['open:div', 'close:div']);
  });

  it('marks runaway tags as unterminated', () => {
    const { tags } = scanHTML('<div<span>');
    expect(tags[0]).toMatchObject({ name: 'div', terminated: false });
    expect(tags[1]).toMatchObject({ name: 'span', terminated: true });
  });
});

describe('html-source linter', () => {
  it('accepts balanced email markup', () => {
    expect(lintHTML('<div>Hello <b>world</b><br></div>')).toEqual([]);
  });

  it('flags unclosed tags', () => {
    const diagnostics = lintHTML('<div><b>bold</div>');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', message: '<b> is never closed' });
  });

  it('flags stray closing tags and closed void elements', () => {
    expect(lintHTML('</div>')[0].message).toContain('no matching opening tag');
    expect(lintHTML('<br></br>')[0].message).toContain('void element');
  });

  it('warns on tags outside the email-safe set', () => {
    const diagnostics = lintHTML('<video></video>');
    expect(diagnostics[0]).toMatchObject({ severity: 'warning' });
    expect(diagnostics[0].message).toContain('not email-safe');
  });

  it('announces that comments will not survive the parse — loud, never silent', () => {
    const diagnostics = lintHTML('<div>a</div><!--[if mso]>ghost<![endif]-->');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'warning' });
    expect(diagnostics[0].message).toContain('drops them');
  });

  it('flags an unterminated comment as an error', () => {
    const diagnostics = lintHTML('<div>a</div><!-- swallowed the rest');
    expect(diagnostics[0]).toMatchObject({ severity: 'error' });
    expect(diagnostics[0].message).toContain('never closed');
  });

  it('warns on ambiguous ampersands that legacy-decode without ";"', () => {
    const diagnostics = lintHTML('<div>save 10% &copy 2026, a=1&#38b</div>');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].message).toContain('"&copy"');
    expect(diagnostics[1].message).toContain('"&#38"');
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('accepts complete entities and plain ampersands in prose', () => {
    expect(lintHTML('<div>Tom & Jerry, 5 &lt; 6 &amp; &#169; fine</div>')).toEqual([]);
  });

  it('warns on images without alt text, including empty alt', () => {
    expect(lintHTML('<div><img src="x.png"></div>')[0].message).toContain('alt text');
    expect(lintHTML('<div><img src="x.png" alt=""></div>')[0].message).toContain('alt text');
    expect(lintHTML('<div><img src="x.png" alt="chart"></div>')).toEqual([]);
  });

  it('enforces the ledger: sub-minimum font sizes and fixed pixel widths, positioned on the declaration', () => {
    const source = '<div style="font-size: 12px; width: 600px">x</div>';
    const diagnostics = lintHTML(source);
    expect(diagnostics.map((d) => source.slice(d.from, d.to))).toEqual([
      'font-size: 12px',
      'width: 600px',
    ]);
    expect(diagnostics[0].message).toContain('14px');
    expect(diagnostics[1].message).toContain('max-width: 600px');
    // The image hybrid and fluid widths are the fix, not the problem.
    expect(
      lintHTML(
        '<img src="x.png" alt="a" width="400" style="width: 100%; max-width: 400px; height: auto;">',
      ),
    ).toEqual([]);
    expect(lintHTML('<div style="width: 100%; max-width: 600px;">x</div>')).toEqual([]);
    expect(lintHTML('<div style="font-size: 14px">x</div>')).toEqual([]);
  });

  it('enforces the ledger: unbroken runs past the phone line budget, merge tags masked', () => {
    const url = 'https://example.com/a/very/long/path/that/never/breaks/anywhere';
    const diagnostics = lintHTML(`<div>${url}</div>`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain(`${url.length} characters`);
    expect(
      lintHTML('<div>{{customer_first_name_and_a_very_long_field_identifier_here}}</div>'),
    ).toEqual([]);
    expect(lintHTML('<div>short words only here</div>')).toEqual([]);
  });

  it('exempts our own deliberate Outlook degradations: fluid inline-block columns and the bordered button anchor', () => {
    expect(
      lintHTML(
        '<div style="display: inline-block; width: 100%; max-width: 300px; vertical-align: top; box-sizing: border-box;">one</div>',
      ),
    ).toEqual([]);
    expect(
      lintHTML(
        '<a href="https://x.io" style="display: inline-block; border-style: solid; border-width: 14px 28px;">Shop</a>',
      ),
    ).toEqual([]);
    const padded = lintHTML(
      '<a href="https://x.io" style="display: inline-block; padding: 14px 28px;">Shop</a>',
    );
    expect(padded).toHaveLength(1);
    expect(padded[0].message).toContain('borders');
    expect(
      lintHTML('<div style="display: inline-block; width: 300px">x</div>').map(
        (d) => d.message.split(' —')[0],
      ),
    ).toEqual(['"display"', '"width: 300px"']);
  });

  it('warns once on a placeholder — an <img> without a source — not about its alt too', () => {
    const diagnostics = lintHTML(
      '<div><img width="320" style="width: 100%; max-width: 320px; height: auto;"></div>',
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].message).toContain('placeholder');
  });

  it('warns on data-URL images — the drop/paste stopgap — positioned on the source', () => {
    const source = '<div><img src="data:image/png;base64,AAAA" alt="a"></div>';
    const diagnostics = lintHTML(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].message).toContain('data URL');
    expect(diagnostics[0].message).toContain('Gmail');
    expect(source.slice(diagnostics[0].from, diagnostics[0].to)).toBe('data:image/png;base64,AAAA');
    expect(lintHTML('<div><img src="cid:part@mail" alt="a"></div>')).toEqual([]);
  });

  it('warns on styles the floor clients ignore, naming the client', () => {
    const diagnostics = lintHTML('<div style="max-width: 600px; color: #333">x</div>');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].message).toContain('"max-width"');
    expect(diagnostics[0].message).toContain('Outlook (Windows)');
  });

  it('exempts the image hybrid: max-width paired with a width attribute is the fix', () => {
    expect(
      lintHTML(
        '<img src="x.png" alt="a" width="400" style="width: 100%; max-width: 400px; height: auto;">',
      ),
    ).toEqual([]);
  });

  it('keeps our own canonical output lint-clean', () => {
    expect(
      lintHTML(
        '<div style="text-align: center;">Hello <strong style="font-weight: bold;">world</strong></div>' +
          '<div><a href="https://x.io" target="_blank" rel="noopener noreferrer">link</a></div>',
      ),
    ).toEqual([]);
  });

  it('errors on script-URL attribute values', () => {
    const diagnostics = lintHTML('<div><a href="javascript:alert(1)">x</a></div>');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error' });
    expect(diagnostics[0].message).toContain('script URL');
  });
});

describe('html-source formatter — merge tags', () => {
  it('pads every token canonically, and the result canonicalizes like the input', () => {
    const formatted = formatHTML('<div>Hi {{firstName}}, {{  cf_70|formatPrice }}!</div>');
    expect(formatted).toBe('<div>Hi {{ firstName }}, {{ cf_70|formatPrice }}!</div>');
    expect(formatHTML('<div>{{#if a}}{{x}}{{/if}} {{~ y ~}}</div>')).toBe(
      '<div>{{#if a}}{{ x }}{{/if}} {{~ y ~}}</div>',
    );
  });
});

describe('html-source formatter — 80 characters', () => {
  const LONG =
    '<div>Sehr geehrte Damen und Herren, vielen Dank für Ihre Nachricht vom letzten Dienstag, die wir mit großem Interesse gelesen haben und heute beantworten.</div>';

  it('wraps running text at spaces to the width, and canonicalizes like the input', () => {
    const formatted = formatHTML(LONG);
    const lines = formatted.split('\n');
    expect(lines[0]).toBe('<div>');
    expect(lines.at(-1)).toBe('</div>');
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => line.length <= 80)).toBe(true);
    expect(lines.slice(1, -1).every((line) => line.startsWith('  ') && !line.startsWith('   '))).toBe(true);
    expect(canonicalEmail(formatted)).toBe(canonicalEmail(LONG));
  });

  it('wraps an over-wide token the way Prettier prints an interpolation, never inside a literal', () => {
    const html =
      "<div>Anbei {{ customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_surname : customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_surname : 'Guten Tag ' + customer_name }}, die Unterlagen.</div>";
    const formatted = formatHTML(html);
    expect(formatted).toBe(
      [
        '<div>',
        '  Anbei',
        '  {{',
        "    customer_gender == 'male' ? 'Sehr geehrter Herr ' + customer_surname :",
        "    customer_gender == 'female' ? 'Sehr geehrte Frau ' + customer_surname :",
        "    'Guten Tag ' + customer_name",
        '  }},',
        '  die Unterlagen.',
        '</div>',
      ].join('\n'),
    );
    expect(formatted.split('\n').every((line) => line.length <= 80)).toBe(true);
    expect(canonicalEmail(formatted)).toBe(canonicalEmail(html));
    // A token that fits stays one word, and one that is a single word overflows whole.
    expect(formatHTML('<div>Hi {{ firstName }}</div>')).toBe('<div>Hi {{ firstName }}</div>');
    const single = `<div>{{ ${'a'.repeat(90)} }}</div>`;
    expect(formatHTML(single)).toBe(`<div>\n  {{ ${'a'.repeat(90)} }}\n</div>`);
  });

  it('never breaks inside a tag, an attribute value or a token', () => {
    const html =
      "<div>Angebot für {{ customer_gender == 'male' ? 'Sehr geehrter Herr' : 'Sehr geehrte Frau' }} <a href=\"https://example.com/a/very/long/path?with=query&amp;and=more\" target=\"_blank\" rel=\"noopener noreferrer\">hier klicken</a> jetzt und <b>fett gedruckt bis zum Ende der Zeile</b> weiter</div>";
    const formatted = formatHTML(html);
    for (const line of formatted.split('\n')) {
      expect((line.match(/\{\{/g) ?? []).length).toBe((line.match(/\}\}/g) ?? []).length);
      expect((line.match(/"/g) ?? []).length % 2).toBe(0); // never inside an attribute value
    }
    expect(formatted).toContain("{{ customer_gender == 'male' ? 'Sehr geehrter Herr' : 'Sehr geehrte Frau' }}");
    expect(canonicalEmail(formatted)).toBe(canonicalEmail(html));
  });

  it('breaks a wide open tag one attribute per line, the > back on the margin', () => {
    const img =
      '<img src="https://example.com/images/newsletter/header-2026-09.png" alt="Header" width="600" style="width: 100%; max-width: 600px; height: auto;">';
    expect(formatHTML(img)).toBe(
      [
        '<img',
        '  src="https://example.com/images/newsletter/header-2026-09.png"',
        '  alt="Header"',
        '  width="600"',
        '  style="width: 100%; max-width: 600px; height: auto;"',
        '>',
      ].join('\n'),
    );
    expect(canonicalEmail(formatHTML(img))).toBe(canonicalEmail(img));
  });

  it('breaks a wide inline tag at its attributes too — an image in a line', () => {
    const html =
      '<div><img src="https://example.com/images/newsletter/header-2026-09.png" alt="Header" width="600" style="width: 100%; max-width: 600px; height: auto;"></div>';
    expect(formatHTML(html)).toBe(
      [
        '<div>',
        '  <img',
        '    src="https://example.com/images/newsletter/header-2026-09.png"',
        '    alt="Header"',
        '    width="600"',
        '    style="width: 100%; max-width: 600px; height: auto;"',
        '  >',
        '</div>',
      ].join('\n'),
    );
    expect(canonicalEmail(formatHTML(html))).toBe(canonicalEmail(html));
    // Text glued to the tag stays glued: no whitespace is invented.
    const glued =
      '<div>Klicken Sie <a href="https://example.com/a/very/long/path/that/keeps/going/and/going" target="_blank" rel="noopener noreferrer">hier</a>, bitte.</div>';
    const formatted = formatHTML(glued);
    expect(formatted).toContain('  >hier</a>,');
    expect(canonicalEmail(formatted)).toBe(canonicalEmail(glued));
  });

  it('prints a wide style attribute as embedded CSS, one declaration per line, like Prettier', () => {
    const columns =
      '<div style="width: 100%; max-width: 600px;">' +
      '<div style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;">' +
      "<div>Frist:</div><div>{{ cf_68 | calcDate:'+2 weeks' | formatDateDE }}</div>" +
      '</div></div>';
    expect(formatHTML(columns)).toBe(
      [
        '<div style="width: 100%; max-width: 600px;">',
        '  <div',
        '    style="',
        '      display: inline-block;',
        '      width: 100%;',
        '      max-width: 280px;',
        '      vertical-align: top;',
        '      box-sizing: border-box;',
        '    "',
        '  >',
        '    <div>Frist:</div>',
        "    <div>{{ cf_68 | calcDate:'+2 weeks' | formatDateDE }}</div>",
        '  </div>',
        '</div>',
      ].join('\n'),
    );
    expect(canonicalEmail(formatHTML(columns))).toBe(canonicalEmail(columns));

    // The button: a block-level anchor whose label lands on its own line — and
    // whose parse collapses it back (parsing is repair).
    const button =
      '<a href="https://x.io" style="display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); font-weight: bold; text-decoration: none; border-width: 14px 28px; border-style: solid; border-color: rgb(26, 115, 232);">Shop now</a>';
    const formatted = formatHTML(button);
    expect(formatted.split('\n')).toEqual([
      '<a',
      '  href="https://x.io"',
      '  style="',
      '    display: inline-block;',
      '    background-color: rgb(26, 115, 232);',
      '    color: rgb(255, 255, 255);',
      '    font-weight: bold;',
      '    text-decoration: none;',
      '    border-width: 14px 28px;',
      '    border-style: solid;',
      '    border-color: rgb(26, 115, 232);',
      '  "',
      '>',
      '  Shop now',
      '</a>',
    ]);
    expect(canonicalEmail(formatted)).toBe(button);
  });

  it('keeps content that fits on one line, and honours a custom width', () => {
    expect(formatHTML('<div>Hi <b>there</b></div>')).toBe('<div>Hi <b>there</b></div>');
    expect(formatHTML('<div>one two three four</div>', '  ', 14)).toBe('<div>\n  one two\n  three four\n</div>');
  });
});

describe('html-source open tags', () => {
  it('tracks the innermost open tag', () => {
    expect(openTags('<blockquote><div>text <b>bold</b> <i>italic')).toEqual([
      'blockquote',
      'div',
      'i',
    ]);
  });

  it('ignores void and self-closing tags', () => {
    expect(openTags('<div><br><img src="x"><span/>')).toEqual(['div']);
  });
});

describe('completion context', () => {
  it('detects tag and closing-tag positions', () => {
    expect(completionContextAt('<di', 3)).toMatchObject({ kind: 'tag', query: 'di' });
    expect(completionContextAt('<', 1)).toMatchObject({ kind: 'tag', query: '' });
    expect(completionContextAt('<div>x</d', 9)).toMatchObject({ kind: 'closing', query: 'd' });
  });

  it('detects attribute positions with the tag and existing attributes', () => {
    expect(completionContextAt('<a href="x" ta', 14)).toMatchObject({
      kind: 'attribute',
      tag: 'a',
      query: 'ta',
      existing: ['href'],
    });
  });

  it('completes style properties but never other attribute values', () => {
    expect(completionContextAt('<div style="color: red; fo', 26)).toMatchObject({
      kind: 'style-property',
      tag: 'div',
      query: 'fo',
    });
    expect(completionContextAt('<div style="color: r', 20)).toBeNull();
    expect(completionContextAt('<a href="ht', 11)).toBeNull();
  });

  it('stays quiet in prose', () => {
    expect(completionContextAt('<div>plain text', 15)).toBeNull();
    expect(completionContextAt('a < b', 5)).toBeNull();
  });
});

describe('html-source formatter', () => {
  it('gives block tags their own indented lines, keeps inline content together', () => {
    const html = '<div>Hello <b>world</b></div><blockquote><div>quoted</div></blockquote>';
    expect(formatHTML(html)).toBe(
      [
        '<div>Hello <b>world</b></div>',
        '<blockquote>',
        '  <div>quoted</div>',
        '</blockquote>',
      ].join('\n'),
    );
  });

  it('drops formatting whitespace on re-format', () => {
    const formatted = formatHTML('<blockquote>\n  <div>a</div>\n</blockquote>');
    expect(formatHTML(formatted)).toBe(formatted);
  });

  it('repairs unclosed tags through the DOM parse', () => {
    expect(formatHTML('<div>Hello <b>world</div>')).toBe('<div>Hello <b>world</b></div>');
  });

  it('never changes the canonical email output', () => {
    const schema = createSchema(emailExtensions);
    const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);
    const html =
      '<div>Hello <b>bold</b> and <a href="https://x.io">link</a></div>' +
      '<div><br></div>' +
      '<blockquote><div>quoted line</div><ul><li>item</li></ul></blockquote>';
    expect(canonical(formatHTML(html))).toBe(canonical(html));
  });
});
