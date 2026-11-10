import { DATA_DETECTORS_RULE, emailDocument } from './email-document';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('email document', () => {
  it('wraps the body in an article carrying lang and dir', () => {
    const doc = parse(emailDocument('<div>Hello</div>', { lang: 'ja', dir: 'ltr' }));
    expect(doc.documentElement.lang).toBe('ja');
    const article = doc.body.firstElementChild as HTMLElement;
    expect(article.getAttribute('role')).toBe('article');
    expect(article.getAttribute('aria-roledescription')).toBe('email');
    expect(article.lang).toBe('ja');
    expect(article.dir).toBe('ltr');
    expect(article.innerHTML).toBe('<div>Hello</div>');
  });

  it('defaults dir to auto and omits lang when not given', () => {
    const html = emailDocument('<div>x</div>');
    expect(html.startsWith('<!doctype html><html dir="auto"')).toBe(true);
    expect(html).not.toContain('lang=');
  });

  it('carries the Outlook DPI settings and the phone rule: stacked columns full width', () => {
    const html = emailDocument('<div>x</div>');
    expect(html).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(html).toContain('<meta name="x-apple-disable-message-reformatting">');
    // The phone rule and iOS's own links: the head's two styles, no dark
    // one beside them.
    expect(html.match(/<style/g)).toHaveLength(2);
    expect(html).toContain(
      '@media only screen and (max-width: 479px) { .aee-stack { max-width: 100% !important; } }',
    );
  });

  it('lets a date, an address or a number iOS Mail linked read as the words round it — in a sheet of its own', () => {
    const doc = parse(emailDocument('<div>Termin am 12.03.2027, Tel. 030 1234567</div>'));
    const sheets = Array.from(doc.head.querySelectorAll('style'), (sheet) => sheet.textContent);
    // Its own sheet, after the phone rule: a client that refuses one keeps the other.
    expect(sheets[1]).toBe(DATA_DETECTORS_RULE);
    expect(sheets[0]).not.toContain('x-apple-data-detectors');
    // Only the links iOS makes: an author's own link carries no such attribute.
    expect(DATA_DETECTORS_RULE.startsWith('a[x-apple-data-detectors] {')).toBe(true);
    for (const property of [
      'color',
      'text-decoration',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
    ]) {
      expect(DATA_DETECTORS_RULE).toMatch(
        new RegExp(`[{ ]${property}: (inherit|none) !important;`),
      );
    }
  });

  it('hooks the rule onto stacking columns only — a held one keeps its share', () => {
    const stacking =
      '<div style="display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;">a</div>';
    const held =
      '<div style="display: inline-block; width: 50%; max-width: 280px; vertical-align: top; box-sizing: border-box;">b</div>';
    const html = emailDocument(stacking + held);
    expect(html).toContain('<div class="aee-stack" style="display: inline-block; width: 100%;');
    expect(html).toContain('<div style="display: inline-block; width: 50%;');
  });

  it('declares no dark: each client draws its light colours dark as it draws any email', () => {
    const html = emailDocument(
      '<div style="display: inline-block; width: 100%; max-width: 280px; background-color: #fce8e6; color: #202124;">' +
        '<span style="color: #c5221f">x</span></div>',
    );
    expect(html).not.toContain('color-scheme');
    expect(html).not.toMatch(/aee-d[btl]-/);
    expect(html).toContain('<span style="color: #c5221f">');
    // The head's two styles say nothing of dark.
    expect(html.match(/<style/g)).toHaveLength(2);
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('puts hidden preview text first, escaped and padded', () => {
    const doc = parse(emailDocument('<div>Body</div>', { previewText: 'Q3 <numbers> & more' }));
    const preview = doc.body.firstElementChild!.firstElementChild as HTMLElement;
    expect(preview.style.display).toBe('none');
    expect(preview.textContent!.startsWith('Q3 <numbers> & more')).toBe(true);
    expect(preview.textContent!.length).toBeGreaterThan(200);
    expect(preview.nextElementSibling!.textContent).toBe('Body');
  });

  it('escapes the title', () => {
    const doc = parse(emailDocument('', { title: 'Tom & Jerry <3' }));
    expect(doc.title).toBe('Tom & Jerry <3');
  });
});
