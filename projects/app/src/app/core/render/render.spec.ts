import { PAPER, readingDocument } from './render';

describe('readingDocument', () => {
  // The palette's black: a colour with a dark variant.
  const body = '<p style="color: #202124">Hello</p>';

  it('lays the email on the editor’s paper, edge to edge, light or dark', () => {
    expect(PAPER).toEqual({ light: '#ffffff', dark: '#1e1e1e' });
    const light = readingDocument(body, { scheme: 'light' });
    expect(light).toContain('html, body { background: #ffffff; } body { margin: 0; }');
    const dark = readingDocument(body, { scheme: 'dark' });
    expect(dark).toContain('html, body { background: #1e1e1e; } body { margin: 0; }');
  });

  it('is a whole document whose links leave for a tab of their own', () => {
    const document = readingDocument(body, { scheme: 'light' });
    expect(document.startsWith('<!doctype html>')).toBe(true);
    expect(document).toContain('<base target="_blank">');
    expect(document).toContain('Hello');
  });

  it('reads dark as Apple Mail does: the email’s own dark rules apply, nothing inverted', () => {
    const dark = readingDocument(body, { scheme: 'dark' });
    // The palette black takes its dark variant through the email's own
    // dark-mode rules (the library's), not a filter over the page.
    expect(dark).not.toContain('invert(');
    expect(dark).toMatch(/aee-dt-/);
  });
});
