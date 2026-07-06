import { formatHTML, lintHTML, openTags, scanHTML } from './html-source';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';
import { emailExtensions } from './extensions/kits';

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

  it('errors on script-URL attribute values', () => {
    const diagnostics = lintHTML('<div><a href="javascript:alert(1)">x</a></div>');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error' });
    expect(diagnostics[0].message).toContain('script URL');
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

describe('html-source formatter', () => {
  it('gives block tags their own indented lines, keeps inline content together', () => {
    const html = '<div>Hello <b>world</b></div><blockquote><div>quoted</div></blockquote>';
    expect(formatHTML(html)).toBe(
      ['<div>Hello <b>world</b></div>', '<blockquote>', '  <div>quoted</div>', '</blockquote>'].join(
        '\n',
      ),
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
