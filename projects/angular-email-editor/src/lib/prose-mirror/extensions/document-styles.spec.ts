import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { parseHTML } from '../html';
import { createSchema } from '../schema';
import { BODY_BOX_PREFIX, DOCUMENT_CLASS, scopedDocumentCss } from './document-styles';

describe('document styles', () => {
  let host: HTMLElement;
  let editor: Editor;

  const page = (body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"></head><body ${body}><div>hi</div></body></html>`;

  const mount = (content: string) => {
    editor = createEditor({ parent: host, extensions: [...emailExtensions], content });
  };

  /** The root's inline style, as the browser holds it. */
  const root = () => editor.view.dom.style;
  const box = (name: string) => root().getPropertyValue(`${BODY_BOX_PREFIX}${name}`).trim();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it("puts the body's look on the root, its box out of the cascade's way", () => {
    mount(page('style="margin: 0; padding: 20px 0; background-color: #f2f2f2; color: #202124"'));
    expect(editor.view.dom.classList).toContain(DOCUMENT_CLASS);
    expect(root().backgroundColor).toBe('rgb(242, 242, 242)');
    expect(root().color).toBe('rgb(32, 33, 36)');
    // A template's `padding: 0` inline would beat every host rule for the
    // root's box — a page layout's gutter, the room under the last line.
    expect(root().padding).toBe('');
    expect(root().margin).toBe('');
    expect(box('margin')).toBe('0');
    expect(box('padding')).toBe('20px 0');
  });

  it('keeps each side of the box apart', () => {
    mount(page('style="padding-left: 8px; margin-top: 4px" bgcolor="#ffffff"'));
    expect(root().paddingLeft).toBe('');
    expect(box('padding-left')).toBe('8px');
    expect(box('margin-top')).toBe('4px');
    expect(root().backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('keeps a value with a semicolon in it whole', () => {
    mount(page(`style="background-image: url('data:image/png;base64,AAAA'); padding: 0"`));
    expect(root().backgroundImage).toContain('data:image/png;base64,AAAA');
    expect(box('padding')).toBe('0');
  });

  it('hoists an @import whole, a semicolon in its URL and all — the rules after it stand', () => {
    const font =
      '@import url(https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap);';
    // Parsed, not mounted: jsdom's CSSOM cannot read an unquoted URL holding
    // a `;` (a browser can).
    const doc = parseHTML(
      '<!doctype html><html><head><style>' +
        `${font}\n@media only screen and (min-width:480px) { .mj-column-per-55 { width:55% !important; } }` +
        '</style></head><body><div>hi</div></body></html>',
      createSchema(emailExtensions),
    );
    const css = scopedDocumentCss(doc, 'x');
    // Whole, its URL quoted (the same to a browser; readable to every parser).
    const quoted = font.replace('url(', 'url("').replace(');', '");');
    expect(css.startsWith(`${quoted}\n@scope (.x) {`)).toBe(true);
    expect(css).toContain('.mj-column-per-55 { width:55% !important; }');
  });

  it('sets nothing on a plain message', () => {
    mount('<div>hi</div>');
    expect(editor.view.dom.classList).not.toContain(DOCUMENT_CLASS);
    expect(editor.view.dom.getAttribute('style') ?? '').not.toContain(BODY_BOX_PREFIX);
  });
});
