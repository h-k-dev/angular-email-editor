import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { PAGE_LAYOUT_CLASS, pageLayoutOf } from './extensions/page-layout';
import { parseHTML, serializeToHTML } from './html';
import { emailDocument } from './email-document';
import { emailPlainText } from './plain-text';
import {
  PageLayout,
  centeredPageLayout,
  normalizePageLayout,
  pageLayoutSheet,
  samePageLayout,
  stylesheetPageLayout,
} from './page-layout';
import { dawnDarkColor } from '@h-k-dev/dawn';

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

  const mount = (content: string) => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
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
    const doc = parseHTML(html, editor.schema);
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
      const doc = parseHTML(html, editor.schema);
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
    const doc = parseHTML(`<blockquote>${inner}</blockquote>`, editor.schema);
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
    // Dark is drawn: the light fill as Dawn draws it.
    expect(root.style.getPropertyValue('--aee-page-background-dark')).toBe(
      dawnDarkColor('#f1f3f4'),
    );
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
      spacing: 0,
      // The column's inset: its default when unsaid, on its grid when said.
      inset: 16,
    });
    expect(normalizePageLayout({ kind: 'centered', inset: 0 })).toMatchObject({ inset: 0 });
    expect(normalizePageLayout({ kind: 'centered', inset: 30 })).toMatchObject({ inset: 32 });
    expect(normalizePageLayout({ kind: 'centered', width: 2000 })?.width).toBe(800);
    expect(normalizePageLayout({ kind: 'centered', spacing: 30 })?.spacing).toBe(32);
    expect(normalizePageLayout({ kind: 'centered', spacing: 500 })?.spacing).toBe(96);
    expect(normalizePageLayout({ kind: 'centered', spacing: -8 })?.spacing).toBe(0);
    expect(normalizePageLayout({ kind: 'other' })).toBeNull();
  });

  it('gives the page room above and below the column as its cell’s padding — Outlook’s too — and reads it back', () => {
    expect(LAYOUT.spacing).toBe(32);
    const html = withLayout(LAYOUT);
    expect(html).toContain(
      '<td bgcolor="#f1f3f4" style="padding: 32px 0px; background-color: rgb(241, 243, 244); color: rgb(32, 33, 36);">',
    );
    mount(html);
    expect(pageLayoutOf(editor.state)).toEqual(LAYOUT);
    expect(editor.getHTML()).toBe(html);
    expect(editor.view.dom.style.getPropertyValue('--aee-page-spacing')).toBe('32px');
    // None: no padding said at all.
    expect(withLayout({ ...LAYOUT, spacing: 0 })).not.toContain('padding: 0px');
  });

  it('paints the body with the page colour in the email document', () => {
    const html = emailDocument(withLayout(LAYOUT));
    expect(html).toMatch(/<body style="[^"]*background-color: #f1f3f4;[^"]*" bgcolor="#f1f3f4">/);
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
      const doc = parseHTML(html, editor.schema);
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.width).toBe(640);
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
    });
  }

  it('leaves the plain text as it was', () => {
    expect(emailPlainText(withLayout(LAYOUT))).toBe(emailPlainText(BODY));
  });

  describe('Stylesheet — the page drawn by the head', () => {
    const SHEET = stylesheetPageLayout({ background: '#ffffff', columnBackground: null });
    const SHEET_RULE = `<style class="aee-layout-page-sheet">${pageLayoutSheet(SHEET)}</style>`;
    const DOCUMENT =
      '<!doctype html><html><head><style>.lead{font-size:18px}</style></head>' +
      `<body>${BODY}</body></html>`;

    const parts = (html: string) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.content;
    };

    it('names the page in the body and says every value in one rule', () => {
      const html = withLayout(SHEET);
      const body = parts(html);
      const [sheet, page] = Array.from(body.children) as [HTMLStyleElement, HTMLTableElement];
      expect(sheet.outerHTML).toBe(SHEET_RULE);
      expect(page.className).toBe('aee-layout-page');
      expect(page.hasAttribute('style')).toBe(false);
      const cell = page.rows[0].cells[0];
      expect(cell.getAttribute('align')).toBe('center');
      expect(cell.hasAttribute('bgcolor')).toBe(false);
      expect(page.getAttribute('bgcolor')).toBe('#ffffff');
      expect(cell.hasAttribute('style')).toBe(false);
      const column = cell.firstElementChild as HTMLElement;
      expect(column.outerHTML.startsWith('<div class="aee-layout-page-column">')).toBe(true);
      expect(Array.from(column.children).map((child) => child.className)).toEqual([
        'aee-layout-page-run',
        'aee-layout-section',
        'aee-layout-page-run',
      ]);
      expect(html).not.toContain('[if mso]');
      expect(html).not.toContain('max-width: 600px');
    });

    it('puts a default band’s inner column on the runs’ class, one inset for all', () => {
      const band = parts(withLayout(SHEET)).querySelector('.aee-layout-section td > div')!;
      expect(band.outerHTML.startsWith('<div class="aee-layout-page-run"><div>band</div>')).toBe(
        true,
      );
      expect(pageLayoutSheet(SHEET)).toBe(
        '.aee-layout-page-column{max-width:600px;margin:32px auto;color:#202124;}' +
          '.aee-layout-page-run{padding-left:32px;padding-right:32px}' +
          '@media only screen and (max-width:479px){.aee-layout-page-column{margin:0px auto}' +
          '.aee-layout-page-run{padding-left:16px;padding-right:16px}}',
      );
    });

    it('round-trips: the rule read back as the layout, every block as it was', () => {
      const layout = stylesheetPageLayout({
        width: 560,
        background: '#f1f3f4',
        columnBackground: '#ffffff',
        spacing: 24,
        inset: 48,
        phoneInset: 12,
        phoneSpacing: 8,
      });
      const html = withLayout(layout);
      const doc = parseHTML(html, editor.schema);
      expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(layout);
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
      mount(html);
      expect(withLayout(null)).toBe(BODY);
    });

    it('writes back what it carries from an author: their phone, their table’s spacing', () => {
      const theirs = stylesheetPageLayout({
        phoneMedia: 'only screen and (max-device-width:480px)',
        cellSpacing: null,
        cellPadding: null,
      });
      const html = withLayout(theirs);
      const page = parts(html).querySelector('table.aee-layout-page')!;
      expect(page.hasAttribute('cellspacing')).toBe(false);
      expect(page.hasAttribute('cellpadding')).toBe(false);
      expect(html).toContain('@media only screen and (max-device-width:480px){');
      const doc = parseHTML(html, editor.schema);
      expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(theirs);
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
      // A new page says ours.
      expect(withLayout(SHEET)).toContain('cellpadding="0" cellspacing="0"');
      // A condition that could end the rule is never written.
      expect(stylesheetPageLayout({ phoneMedia: 'screen}body{display:none' }).phoneMedia).toBe(
        'only screen and (max-width:479px)',
      );
    });

    it('takes its rule off the head before the envelope is read, and puts it back', () => {
      mount(DOCUMENT);
      const before = editor.state.doc.attrs['envelope'];
      const html = withLayout(SHEET);
      expect(html).toContain(`font-size:18px`);
      expect(html).toContain(`</style>\n${SHEET_RULE}\n</head>`);
      expect(html.match(/aee-layout-page-sheet/g)).toHaveLength(1);
      const doc = parseHTML(html, editor.schema);
      expect(doc.attrs['envelope']).toEqual(before);
      expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(SHEET);
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
    });

    it('stays a Stylesheet page where a client dropped the rule — the defaults', () => {
      const html = withLayout(SHEET).replace(SHEET_RULE, '');
      const doc = parseHTML(html, editor.schema);
      expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(
        stylesheetPageLayout({ background: '#ffffff', columnBackground: null }),
      );
      expect(serializeToHTML(doc, editor.schema)).toBe(withLayout(SHEET));
    });

    it('sends its rule in the email document’s head', () => {
      const html = emailDocument(withLayout(SHEET));
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain(SHEET_RULE);
      expect(html.indexOf('aee-layout-page-sheet')).toBe(html.lastIndexOf('aee-layout-page-sheet'));
      expect(html).toMatch(/<body style="[^"]*background-color: #ffffff;/);
    });

    it('normalises its own room: phone inset and room on the 4px grid, the defaults', () => {
      expect(
        normalizePageLayout({ kind: 'stylesheet', inset: 61, phoneInset: 99, phoneSpacing: -3 }),
      ).toMatchObject({ kind: 'stylesheet', inset: 60, phoneInset: 64, phoneSpacing: 0 });
      expect(normalizePageLayout({ kind: 'stylesheet' })).toMatchObject({
        inset: 32,
        phoneInset: 16,
        phoneSpacing: 0,
      });
      expect(samePageLayout(SHEET, { ...SHEET, phoneInset: 20 })).toBe(false);
      expect(samePageLayout(SHEET, stylesheetPageLayout(SHEET))).toBe(true);
    });

    it('leaves the plain text as it was', () => {
      expect(emailPlainText(withLayout(SHEET))).toBe(emailPlainText(BODY));
    });

    for (const file of examples) {
      it(`round-trips ${file} in a Stylesheet page`, () => {
        mount(fs.readFileSync(`${EXAMPLES}${file}`, 'utf8'));
        const html = withLayout(stylesheetPageLayout({ width: 640 }));
        const doc = parseHTML(html, editor.schema);
        expect(normalizePageLayout(doc.attrs['pageLayout'])?.kind).toBe('stylesheet');
        expect(serializeToHTML(doc, editor.schema)).toBe(html);
      });
    }
  });
});
