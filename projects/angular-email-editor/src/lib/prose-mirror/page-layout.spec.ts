import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { PAGE_LAYOUT_CLASS, pageLayoutOf } from './extensions/page-layout';
import { parseHTML, serializeToHTML } from './html';
import { emailDocument } from './email-document';
import { emailPlainText } from './plain-text';
import { PageLayout, centeredPageLayout, normalizePageLayout } from './page-layout';

describe('page layout', () => {
  let host: HTMLElement;
  let editor: Editor;

  const BAND =
    '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
    '<td bgcolor="#e8f0fe" style="padding: 20px 0px; background-color: rgb(232, 240, 254); color: rgb(32, 33, 36);">' +
    '<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;"><div>band</div></div>' +
    '</td></tr></tbody></table>';
  const BODY = `<div>before</div>${BAND}<div>after</div>`;
  const LAYOUT: PageLayout = centeredPageLayout();

  const mount = (content: string, parseMode: 'repair' | 'preserve' | 'email' = 'preserve') => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content, parseMode });
  };
  const withLayout = (layout: PageLayout | null) => {
    editor.commands['setPageLayout'](layout);
    return editor.getHTML();
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    mount(BODY);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('is no layout by default — the body as the composer writes it', () => {
    expect(pageLayoutOf(editor.state)).toBeNull();
    expect(editor.getHTML()).toBe(BODY);
  });

  it('stands the whole body, sections too, in one capped column on a 100% page table', () => {
    const html = withLayout(LAYOUT);
    const template = document.createElement('template');
    template.innerHTML = html;
    const page = template.content.firstElementChild as HTMLTableElement;
    expect(template.content.children.length).toBe(1);
    expect(page.className).toBe('aee-layout-page');
    expect(page.getAttribute('role')).toBe('presentation');
    expect(page.getAttribute('width')).toBe('100%');
    const cell = page.rows[0].cells[0];
    expect(cell.getAttribute('bgcolor')).toBe('#f1f3f4');
    expect(Array.from(cell.children).map((child) => child.className)).toEqual([
      'aee-layout-page-column',
    ]);
    const column = cell.children[0] as HTMLElement;
    expect(column.style.maxWidth).toBe('600px');
    expect(column.style.backgroundColor).toBe('rgb(255, 255, 255)');
    // The text between sections in runs with the column's inset; the band
    // fills the column, as it is.
    expect(Array.from(column.children).map((child) => child.className)).toEqual([
      'aee-layout-page-run',
      'aee-layout-section',
      'aee-layout-page-run',
    ]);
    expect((column.children[0] as HTMLElement).style.padding).toBe('16px');
    expect(column.children[0].textContent).toBe('before');
    expect(column.children[1].outerHTML).toBe(BAND);
  });

  it("puts the column in Outlook's ghost table — conditional comments round the one div", () => {
    const html = withLayout(LAYOUT);
    expect(html).toContain(
      '<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#ffffff"',
    );
    expect(html.match(/<!--\[if mso\]><table role="presentation" align="center"/g)?.length).toBe(1);
    expect(html.match(/<!--\[if mso\]><\/td><\/tr><\/table><!\[endif\]-->/g)?.length).toBe(1);
    expect(html.match(/before|after|band/g)).toEqual(['before', 'band', 'after']);
  });

  it('caps the sections at the layout width too, and gives them back their own on parse', () => {
    const html = withLayout(centeredPageLayout({ width: 640 }));
    expect(html).toContain('max-width: 640px; margin-left: auto');
    expect(html).not.toContain('max-width: 600px');
    const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
    expect(serializeToHTML(doc.type.create(null, doc.content), editor.schema)).toBe(BODY);
  });

  for (const mode of ['repair', 'email', 'preserve'] as const) {
    it(`round-trips through the ${mode} parse: the page is the document's attribute, the blocks as they were`, () => {
      const layout = centeredPageLayout({
        width: 560,
        background: '#e6f4ea',
        columnBackground: null,
      });
      const html = withLayout(layout);
      const doc = parseHTML(html, editor.schema, { mode });
      expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(layout);
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
    });
  }

  it('comes with content: setContent brings the page, and takes it away', () => {
    const html = withLayout(LAYOUT);
    mount(BODY);
    editor.setContent(html);
    expect(pageLayoutOf(editor.state)).toEqual(LAYOUT);
    expect(editor.getHTML()).toBe(html);
    editor.setContent(BODY);
    expect(pageLayoutOf(editor.state)).toBeNull();
  });

  it('is one undoable step', () => {
    withLayout(LAYOUT);
    expect(editor.commands['undo']()).toBe(true);
    expect(pageLayoutOf(editor.state)).toBeNull();
  });

  it('unwraps a page inside the body (a quoted message) without taking its layout', () => {
    const inner = withLayout(LAYOUT);
    const doc = parseHTML(`<blockquote>${inner}</blockquote>`, editor.schema, { mode: 'preserve' });
    expect(doc.attrs['pageLayout']).toBeNull();
    expect(serializeToHTML(doc, editor.schema)).not.toContain('aee-layout-page');
  });

  it('tells the editor root, which the host draws the page from', () => {
    withLayout(LAYOUT);
    const root = editor.view.dom;
    expect(root.classList).toContain(PAGE_LAYOUT_CLASS);
    expect(root.dataset['pageLayout']).toBe('centered');
    expect(root.style.getPropertyValue('--aee-page-width')).toBe('600px');
    expect(root.style.getPropertyValue('--aee-page-background')).toBe('#f1f3f4');
    expect(root.style.getPropertyValue('--aee-page-background-dark')).toBe('#2f3031');
    expect(root.style.getPropertyValue('--aee-page-column')).toBe('#ffffff');
    withLayout(null);
    expect(root.classList).not.toContain(PAGE_LAYOUT_CLASS);
  });

  it('normalises what it is given: the width on its 4px grid within bounds, unsafe colours dropped', () => {
    expect(
      normalizePageLayout({
        kind: 'centered',
        width: 601,
        background: 'red;x',
        columnBackground: '#FFF',
      }),
    ).toEqual({
      kind: 'centered',
      width: 600,
      background: null,
      columnBackground: '#fff',
    });
    expect(normalizePageLayout({ kind: 'centered', width: 2000 })?.width).toBe(800);
    expect(normalizePageLayout({ kind: 'other' })).toBeNull();
  });

  it('paints the body with the page colour in the email document, dark class and all', () => {
    const html = emailDocument(withLayout(LAYOUT));
    expect(html).toMatch(
      /<body class="aee-db-f1f3f4" style="[^"]*background-color: #f1f3f4;[^"]*" bgcolor="#f1f3f4">/,
    );
    expect(emailDocument(BODY)).toContain('<body style="margin: 0;');
  });

  // The catalogue's own templates — a hero band with an image and its
  // Outlook VML (the shipping confirmation), columns with their comments,
  // whole MJML documents — each round-trips in its page, as the composer
  // parses it.
  const fs = (globalThis as any).process.getBuiltinModule('fs');
  const EXAMPLES = 'projects/app/public/examples/';
  const examples: string[] = JSON.parse(fs.readFileSync(`${EXAMPLES}index.json`, 'utf8'))
    .sets.flatMap((set: { examples: { file: string }[] }) => set.examples)
    .map((example: { file: string }) => example.file)
    .filter((file: string) => file.endsWith('.html'));
  for (const file of examples) {
    it(`round-trips ${file} in its page`, () => {
      mount(fs.readFileSync(`${EXAMPLES}${file}`, 'utf8'));
      const html = withLayout(centeredPageLayout({ width: 640 }));
      const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.width).toBe(640);
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
    });
  }

  it('leaves the plain text as it was', () => {
    expect(emailPlainText(withLayout(LAYOUT))).toBe(emailPlainText(BODY));
  });
});
