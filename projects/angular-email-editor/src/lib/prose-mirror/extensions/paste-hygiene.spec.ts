import { TextSelection } from 'prosemirror-state';
import { sanitizePastedHTML } from './paste-hygiene';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { pageLayoutOf } from './page-layout';
import { authoredPageBands } from '../authored-page';

/** A page of rows as the editor sends it (page-layout.ts): marked, with
    authored text styles and a hand-built table in its rows. */
const PAGE =
  '<!doctype html><html lang="de"><head><meta charset="utf-8"></head>' +
  '<body style="margin:0;padding:0;background:#efe9e1">' +
  '<table class="aee-layout-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
  '<td bgcolor="#efe9e1" style="padding: 32px 0px; background-color: rgb(239, 233, 225); color: rgb(32, 33, 36);">' +
  '<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
  '<table class="aee-layout-page-column" role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0px auto; width: 100%; border-collapse: collapse;"><tbody>' +
  '<tr><td class="aee-layout-page-row" bgcolor="#ffffff" style="padding: 36px 40px 18px; background-color: rgb(255, 255, 255); color: rgb(32, 33, 36);">' +
  '<div style="text-align: center;"><div style="font-family:Didot,Georgia,serif;font-size:56px;letter-spacing:-2px;color:#111111">VOGUE</div></div>' +
  '</td></tr>' +
  '<tr><td class="aee-layout-page-row" bgcolor="#ffffff" style="padding: 0px 40px 28px; background-color: rgb(255, 255, 255); color: rgb(32, 33, 36);">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px"><tbody><tr>' +
  '<td style="padding:8px 0;border-top:1px solid #e4dccf;width:40%">Aktenzeichen</td>' +
  '<td style="padding:8px 0;border-top:1px solid #e4dccf">{{ case_number }}</td>' +
  '</tr></tbody></table>' +
  '</td></tr>' +
  '</tbody></table>' +
  '<!--[if mso]></td></tr></table><![endif]-->' +
  '</td></tr></tbody></table></body></html>';

describe('paste hygiene', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (content = '') => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
  };
  /** Pastes `html` as the browser hands it over: on the clipboard. */
  const paste = (html: string) => {
    const event = Object.assign(new Event('paste'), {
      clipboardData: { getData: (type: string) => (type === 'text/html' ? html : '') },
    }) as unknown as ClipboardEvent;
    editor.view.pasteHTML(html, event);
    return editor.getHTML();
  };
  const caretAt = (pos: number) =>
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    mount();
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  describe('the cleanup', () => {
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

    it("removes the clipboard's fragment marks, and no other comment", () => {
      const windows =
        '<html><body><!--StartFragment--><div>x</div><!--[if mso]>y<![endif]--><!--EndFragment--></body></html>';
      expect(sanitizePastedHTML(windows)).toBe('<div>x</div><!--[if mso]>y<![endif]-->');
    });

    it('leaves legitimate content and marks untouched', () => {
      const clean = '<div>Keep <strong>this</strong> and <a href="https://x.io">links</a></div>';
      expect(sanitizePastedHTML(clean)).toBe(clean);
    });
  });

  describe("the clipboard's own wrapper", () => {
    it("takes off Google Docs' guid wrapper, and no other bold", () => {
      expect(
        sanitizePastedHTML(
          '<b style="font-weight:normal" id="docs-internal-guid-abc"><p>a <b>b</b></p></b>',
        ),
      ).toBe('<p>a <b>b</b></p>');
    });
  });

  describe('a paste reads as a load', () => {
    it('an email pasted over the empty document is the email loaded: its page and its markup', () => {
      const pasted = paste(PAGE);
      const loaded = createEditor({ parent: host, extensions: emailExtensions, content: PAGE });
      // The page is ours, lifted and sent again; everything in it as authored.
      expect(pasted).toBe(loaded.getHTML().replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/g, ''));
      expect(pageLayoutOf(editor.state)).toEqual(pageLayoutOf(loaded.state));
      expect(pasted).toContain('letter-spacing:-2px');
      expect(pasted).toContain('<td style="padding:8px 0;border-top:1px solid #e4dccf;width:40%">');
      loaded.destroy();
    });

    it('an email pasted over the whole document keeps its outermost wrapper, as a load does', () => {
      // MJML's: the body's `role="article"` div round its bands, its fill.
      const mjml = (globalThis as any).process
        .getBuiltinModule('fs')
        .readFileSync('projects/app/public/examples/mjml/racoon.html', 'utf8') as string;
      mount('<div>replace me</div>');
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1),
        ),
      );
      paste(mjml);
      const loaded = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: sanitizePastedHTML(mjml),
      });
      expect(editor.state.doc.toJSON()).toEqual(loaded.state.doc.toJSON());
      const wrapper = editor.state.doc.firstChild!;
      expect(wrapper.attrs['attrs']).toContainEqual(['role', 'article']);
      // Whole, the centred column it is stays offered (authored-page.ts).
      expect(authoredPageBands(wrapper, editor.state.schema)?.shape).toBe('centred-bands');
      loaded.destroy();
    });

    it('a page pasted into the text brings its blocks, not its layout', () => {
      mount('<div>before</div>');
      caretAt(editor.state.doc.content.size - 1);
      const pasted = paste(PAGE);
      expect(pageLayoutOf(editor.state)).toBeNull();
      expect(pasted).toContain('before');
      expect(pasted).toContain('VOGUE');
      expect(pasted).not.toContain('aee-layout-page');
    });

    it('words pasted into a line join it', () => {
      mount('<div>ab</div>');
      caretAt(2);
      expect(paste('<meta charset="utf-8"><b>x</b>')).toBe('<div>a<b>x</b>b</div>');
    });

    it('Word paste keeps its words and its bold, not its markup soup', () => {
      const word =
        '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>' +
        '<style><!-- .MsoNormal { mso-style-parent: ""; } --></style></head><body>' +
        '<p class="MsoNormal" style="mso-margin-top-alt:auto">Hello <b>world</b><o:p></o:p></p>' +
        '</body></html>';
      expect(paste(word)).toBe('<div>Hello <b>world</b></div>');
    });

    it('Google Docs paste renders as copied: the bold span bold, the rest plain', () => {
      const gdocs =
        '<b style="font-weight:normal" id="docs-internal-guid-abc123">' +
        '<p dir="ltr"><span style="font-weight:700">bold</span> plain</p></b>';
      // Pasted into the line, its wrappers open into it (as typing would);
      // the words keep the styles they were drawn with.
      const pasted = paste(gdocs);
      expect(pasted).toBe('<div><span style="font-weight:700">bold</span> plain</div>');
    });
  });
});
