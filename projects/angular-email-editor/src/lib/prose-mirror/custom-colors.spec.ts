import { emailDocument } from './email-document';
import { parseHTML, serializeToHTML } from './html';
import { createEditor } from './editor';
import { emailExtensions } from './extensions/kits';

describe('custom colours', () => {
  const schema = createEditor({
    parent: document.createElement('div'),
    extensions: emailExtensions,
  }).schema;

  it('are written like any colour: the light one, nothing marking them', () => {
    const doc = parseHTML('<div><span style="color: #4a1d4f">picked</span></div>', schema, {
      mode: 'preserve',
    });
    const html = serializeToHTML(doc, schema);
    expect(html).toContain('color: #4a1d4f');
    expect(html).not.toContain('data-aee-');
  });

  it('lose an older email’s stamps on parse, in every mode — the colours kept', () => {
    const older =
      '<table><tbody><tr><td data-aee-fill="#efe9e1" style="background-color: #efe9e1;">' +
      '<span data-aee-color="#4a1d4f" style="color: #4a1d4f;">picked</span></td></tr></tbody></table>';
    for (const mode of ['repair', 'email', 'preserve'] as const) {
      const html = serializeToHTML(parseHTML(older, schema, { mode }), schema);
      expect(html, mode).not.toContain('data-aee-');
      expect(html, mode).toMatch(/#4a1d4f|rgb\(74, 29, 79\)/);
    }
  });
});

describe('the sent email', () => {
  it('declares no dark: no color-scheme, no dark rules, no dark classes', () => {
    const html = emailDocument(
      '<table class="aee-layout-page" role="presentation" width="100%"><tbody><tr>' +
        '<td bgcolor="#f1f3f4" style="background-color: #f1f3f4;">' +
        '<p style="color: #c5221f">x</p></td></tr></tbody></table>',
    );
    expect(html).not.toMatch(/color-scheme/i);
    expect(html).not.toContain('prefers-color-scheme');
    expect(html).not.toContain('data-ogsc');
    expect(html).not.toMatch(/aee-d[btl]-/);
    // The page's colour still reaches the body.
    expect(html).toContain('bgcolor="#f1f3f4"');
  });
});
