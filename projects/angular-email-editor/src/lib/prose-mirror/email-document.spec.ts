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

  it('carries the Outlook DPI settings and no style block', () => {
    const html = emailDocument('<div>x</div>');
    expect(html).toContain('<o:PixelsPerInch>96</o:PixelsPerInch>');
    expect(html).toContain('<meta name="x-apple-disable-message-reformatting">');
    expect(html).not.toContain('<style');
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
