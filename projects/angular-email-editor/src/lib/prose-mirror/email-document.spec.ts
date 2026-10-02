import { emailDocument } from './email-document';

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

  it('carries the Outlook DPI settings and one style rule: stacked columns full width on a phone', () => {
    const html = emailDocument('<div>x</div>');
    expect(html).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(html).toContain('<meta name="x-apple-disable-message-reformatting">');
    expect(html.match(/<style/g)).toHaveLength(1);
    expect(html).toContain(
      '@media only screen and (max-width: 479px) { .aee-stack { max-width: 100% !important; } }',
    );
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
