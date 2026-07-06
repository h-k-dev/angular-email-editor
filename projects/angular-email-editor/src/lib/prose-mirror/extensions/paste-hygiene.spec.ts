import { sanitizePastedHTML } from './paste-hygiene';
import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';

/** The full paste pipeline: hygiene pass, then the schema parse. */
function paste(html: string): string {
  const schema = createSchema(emailExtensions);
  return serializeToHTML(parseHTML(sanitizePastedHTML(html), schema), schema);
}

const BOLD_OPEN = '<strong style="font-weight: bold;">';

describe('paste hygiene', () => {
  it('removes style blocks whose CSS would leak into the text', () => {
    const word =
      '<html><head><style>.MsoNormal { margin: 0; }</style></head>' +
      '<body><style>p { color: red; }</style><p>Hello</p></body></html>';
    expect(sanitizePastedHTML(word)).toBe('<p>Hello</p>');
  });

  it('removes Word namespaced tags and fake list glyphs', () => {
    const word =
      '<p class="MsoNormal">Hello <b>world</b><o:p></o:p></p>' +
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">' +
      '<!--[if !supportLists]--><span style="mso-list:Ignore">·<span style="font:7.0pt">&nbsp;&nbsp;</span></span><!--[endif]-->' +
      'First item</p>';
    const sanitized = sanitizePastedHTML(word);
    expect(sanitized).not.toContain('o:p');
    expect(sanitized).not.toContain('·');
    expect(sanitized).toContain('First item');
  });

  it('Word paste survives the whole pipeline as clean canonical email HTML', () => {
    const word =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>' +
      '<style><!-- .MsoNormal { mso-style-parent: ""; } --></style></head><body>' +
      '<p class="MsoNormal" style="mso-margin-top-alt:auto">Hello <b>world</b><o:p></o:p></p>' +
      '</body></html>';
    expect(paste(word)).toBe(`<div>Hello ${BOLD_OPEN}world</strong></div>`);
  });

  it('Google Docs paste: the font-weight:normal wrapper never reads as bold', () => {
    const gdocs =
      '<b style="font-weight:normal" id="docs-internal-guid-abc123">' +
      '<p dir="ltr"><span style="font-weight:700">bold</span> plain</p></b>';
    expect(paste(gdocs)).toBe(`<div>${BOLD_OPEN}bold</strong> plain</div>`);
  });

  it('leaves legitimate content and marks untouched', () => {
    const clean = '<div>Keep <strong>this</strong> and <a href="https://x.io">links</a></div>';
    expect(sanitizePastedHTML(clean)).toBe(clean);
  });
});
