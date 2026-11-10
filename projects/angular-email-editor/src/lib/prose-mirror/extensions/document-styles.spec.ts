import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { parseHTML } from '../html';
import { createSchema } from '../schema';
import { BODY_BOX_PREFIX, DOCUMENT_CLASS, scopedDocumentCss } from './document-styles';

/** A sheet's text, its line breaks and indents aside (the head is stored in
    its own line form). */
const spaced = (css: string) => css.replace(/\s+/g, ' ').trim();

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

  describe('a rule for the body, sent to the root', () => {
    const schema = createSchema(emailExtensions);
    /** The scoped sheet of a document with this head CSS and body tag. */
    const sheet = (css: string, body = '', options = {}) =>
      scopedDocumentCss(
        parseHTML(
          `<!doctype html><html dir="ltr"><head><style>${css}</style></head><body ${body}><div>hi</div></body></html>`,
          schema,
        ),
        'x',
        options,
      );
    /** The root, as a rule for the body itself is said of it. */
    const ROOT = 'div:where(:scope):not(#aee-no-such-id)';
    const DARK = "@scope (:where([data-color-scheme='dark']) .aee-editor.x) {";
    const LIGHT = "@scope (.x:not(:where([data-color-scheme='dark']) .aee-editor)) {";

    it('gives the root the body’s look and keeps its box out: margin and padding as custom properties, the rest of its geometry left behind', () => {
      const css = sheet(
        'body { margin: 0; padding: 0 !important; width: 100% !important; height: 100% !important; font-family: Georgia, serif; -webkit-text-size-adjust: 100%; }',
      );
      expect(css).toContain(
        `${ROOT} { ${BODY_BOX_PREFIX}margin: 0; ${BODY_BOX_PREFIX}padding: 0 !important; font-family: Georgia, serif; -webkit-text-size-adjust: 100%; }`,
      );
      expect(css).not.toContain('width: 100%');
      expect(css).not.toContain('height: 100%');
      expect(css).not.toMatch(/(^|[\s,])body\b/);
    });

    it('splits a list: the body’s share to the root, the others as written', () => {
      const css = sheet('body, table, td { font-family: Arial; padding: 4px; }');
      expect(css).toContain('table, td { font-family: Arial; padding: 4px; }');
      expect(css).toContain(`${ROOT} { font-family: Arial; ${BODY_BOX_PREFIX}padding: 4px; }`);
    });

    it('reads the selector against the body the document has: its class, its html, an Outlook.com marker it never carries', () => {
      const css = sheet(
        'body.generic { color: #111111; } body.other { color: #222222; } ' +
          '[data-ogsc] body { color: #333333; } html[dir="ltr"] body { letter-spacing: 1px; }',
        'class="generic"',
      );
      // The weight the selector had rides along, so two body rules still meet as written.
      expect(css).toContain(
        'div:where(:scope):is(*.generic, *):not(#aee-no-such-id) { color: #111111; }',
      );
      expect(css).toContain(
        'div:where(:scope):is(html[dir="ltr"] *, *):not(#aee-no-such-id) { letter-spacing: 1px; }',
      );
      expect(css).not.toContain('#222222');
      expect(css).not.toContain('#333333');
    });

    it('says a rule for what is in the body of the root too, at the weight it had', () => {
      const css = sheet(
        'body td { padding: 4px; } body.generic > table { width: 100%; } body.other td { padding: 8px; }',
        'class="generic"',
      );
      expect(css).toContain('div:where(:scope) td { padding: 4px; }');
      // Not the body itself: nothing of the rule is left out.
      expect(css).toContain('div:where(:scope):is(*.generic, *) > table { width: 100%; }');
      expect(css).not.toContain('padding: 8px');
    });

    it('reaches into @media, and leaves @font-face and a sheet with no body rule as written', () => {
      const face =
        '@font-face { font-family: "X"; src: url("https://example.com/x.woff2") format("woff2"); }';
      const plain = `${face}\n/* a note; with { braces } */\ntable, td { vertical-align: top; }`;
      expect(spaced(sheet(plain))).toBe(spaced(`@scope (.x) {\n${plain}\n}`));
      const css = sheet(
        '@media screen and (max-width: 480px) { body { font-size: 14px; } td { padding: 0; } }',
      );
      expect(css).toContain('@media screen and (max-width: 480px) {');
      expect(css).toContain(`${ROOT} { font-size: 14px; }`);
      expect(css).toContain('td { padding: 0; }');
    });

    it('draws what a body rule paints dark on dark paper — right after the rule, as important as it was', () => {
      const css = sheet(
        'body { background-color: #f4f4f4; color: #333333 !important; } p { margin: 0; }',
      );
      const [light, dark, rest] = css.split('@scope ').slice(1);
      expect(light).toContain(`${ROOT} { background-color: #f4f4f4; color: #333333 !important; }`);
      expect(`@scope ${dark}`.startsWith(DARK)).toBe(true);
      const drawn = /background-color: ([^;]+); color: ([^;]+) !important;/.exec(dark)!;
      expect(drawn[1]).not.toBe('#f4f4f4');
      expect(drawn[2]).not.toBe('#333333');
      // The rules after it stand after it.
      expect(rest).toContain('p { margin: 0; }');
    });
  });

  describe('prefers-color-scheme — the paper’s to answer', () => {
    const schema = createSchema(emailExtensions);
    const sheet = (css: string, options = {}) =>
      scopedDocumentCss(
        parseHTML(
          `<!doctype html><html><head><style>${css}</style></head><body><div>hi</div></body></html>`,
          schema,
        ),
        'x',
        options,
      );

    it('scopes a document’s dark rules to the dark paper and its light ones to the light, in the order written, the question taken out', () => {
      const css = sheet(
        'p { color: #111111; }\n' +
          '@media (prefers-color-scheme: dark) { p { color: #ffffff !important; } }\n' +
          '@media (prefers-color-scheme: light) and (max-width: 480px) { p { color: #222222; } }\n' +
          'h1 { margin: 0; }',
      );
      expect(css).not.toContain('prefers-color-scheme');
      const blocks = css.split(/\n(?=@scope )/);
      expect(blocks.map((block) => block.slice(0, block.indexOf('{') + 1))).toEqual([
        '@scope (.x) {',
        "@scope (:where([data-color-scheme='dark']) .aee-editor.x) {",
        "@scope (.x:not(:where([data-color-scheme='dark']) .aee-editor)) {",
        '@scope (.x) {',
      ]);
      expect(blocks[0]).toContain('p { color: #111111; }');
      // Nothing else asked: the rules stand in the scope as they are.
      expect(blocks[1]).toContain('p { color: #ffffff !important; }');
      expect(blocks[1]).not.toContain('@media');
      // Something else asked too: that stays a query.
      expect(blocks[2]).toContain(
        '@media (min-width: 0px) and (max-width: 480px) { p { color: #222222; } }',
      );
      expect(blocks[3]).toContain('h1 { margin: 0; }');
    });

    it('sends a dark rule for the body to the root, in the dark scope', () => {
      const css = sheet(
        '@media (prefers-color-scheme: dark) { body { background-color: #000000 !important; } }',
      );
      expect(spaced(css)).toBe(
        "@scope (:where([data-color-scheme='dark']) .aee-editor.x) { " +
          'div:where(:scope):not(#aee-no-such-id) { background-color: #000000 !important; } }',
      );
    });

    it('takes the host’s own word for a dark paper', () => {
      const css = sheet('@media (prefers-color-scheme: dark) { p { color: #ffffff; } }', {
        darkScope: ".paper[data-color-scheme='dark'] > .aee-editor",
      });
      expect(css.startsWith("@scope (.paper[data-color-scheme='dark'] > .aee-editor.x) {")).toBe(
        true,
      );
    });
  });
});
