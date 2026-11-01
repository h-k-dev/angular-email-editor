import { undo } from 'prosemirror-history';
import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { parseHTML, serializeToHTML } from './html';
import { authoredPageBands, convertAuthoredPageToStylesheet } from './authored-page';
import { normalizePageLayout, stylesheetPageLayout } from './page-layout';
import { createSchema } from './schema';

const fs = (globalThis as any).process.getBuiltinModule('fs');
/** The catalogue's New device sign-in: Notion's way — a 100% table, one
    cell, `div.ae-mail` capped and inset by the head's rule. */
const SIGN_IN = fs.readFileSync(
  'projects/app/public/examples/angularjs/new-sign-in.html',
  'utf8',
) as string;

const schema = createSchema(emailExtensions);
const LAYOUT = stylesheetPageLayout({
  // The rule's 600px is the wrapper's content box: the column is it and
  // both insets.
  width: 720,
  background: '#ffffff',
  columnBackground: null,
  spacing: 0,
  inset: 60,
  phoneInset: 16,
  phoneSpacing: 0,
  // Theirs carried: a phone as their rule says it, their table's spacing
  // left to the browser as they left it.
  phoneMedia: 'only screen and (max-device-width:480px)',
  cellSpacing: null,
  cellPadding: null,
});

const head = (html: string) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const document_ = (css: string, body: string) =>
  `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;
const wrapped = (inside = '<div>words</div>') =>
  `<table width="100%"><tbody><tr><td align="center"><div class="frame">${inside}</div></td></tr></tbody></table>`;

describe('a page drawn by its head — offered as a Stylesheet page', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (content: string) => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('is kept as written on parse — no page lifted', () => {
    const doc = parseHTML(SIGN_IN, schema);
    expect(doc.attrs['pageLayout']).toBeNull();
    expect(serializeToHTML(doc, schema)).toContain('<div class="ae-mail">');
  });

  it('recognises it with the document’s head — and not without', () => {
    const doc = parseHTML(SIGN_IN, schema);
    expect(doc.childCount).toBe(1);
    expect(authoredPageBands(doc.child(0), schema)).toBeNull();
    const conversion = authoredPageBands(doc.child(0), schema, doc)!;
    expect(conversion.shape).toBe('stylesheet-page');
    expect(conversion.stylesheet!.wrapper).toBe('ae-mail');
    expect(conversion.stylesheet!.layout).toEqual(LAYOUT);
  });

  it('converted: our page, their wrapper and type kept, the layout’s values moved — one undo step', () => {
    mount(SIGN_IN);
    const before = editor.getHTML();
    expect(editor.exec(convertAuthoredPageToStylesheet(0))).toBe(true);
    const doc = editor.state.doc;
    expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(LAYOUT);
    const html = editor.getHTML();
    // Their outer table is ours now; their wrapper stands in our column.
    expect(html).not.toContain('id="ae-body-table"');
    expect(html).toContain(
      '<td align="center"><div class="aee-layout-page-column"><div class="aee-layout-page-run"><div class="ae-mail">',
    );
    // The head: their type and vertical room stay, the cap and side room
    // are the layout's, the outer table's own rule gone.
    const after = head(html);
    expect(after).toContain('.ae-mail,td{font-family:');
    expect(after).toMatch(
      /\.ae-mail\{text-align:left;\s*line-height:1\.5;\s*padding-top:36px\s*\}/,
    );
    expect(after).toMatch(/\.ae-mail\{\s*padding-top:0\s*\}/);
    expect(after).not.toMatch(/\.ae-mail\{[^}]*(max-width|padding-left|padding-right)/);
    // …which says them in its own rule.
    expect(after).toContain('.aee-layout-page-run{padding-left:60px;padding-right:60px}');
    expect(after).not.toContain('ae-body-table');
    expect(after).toContain('.ae-mail-button:hover');
    expect(after).toContain('aee-layout-page-sheet');
    expect(doc.textContent).toContain('New sign-in to your Analytical Engines account');
    // Read back, it is the same page of ours.
    const again = parseHTML(html, schema);
    expect(normalizePageLayout(again.attrs['pageLayout'])).toEqual(LAYOUT);
    expect(serializeToHTML(again, schema)).toBe(html);
    // Asked twice, it is no longer offered.
    expect(editor.exec(convertAuthoredPageToStylesheet(0))).toBe(false);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe(before);
  });

  it('takes the cap as it is where the wrapper says border-box', () => {
    const doc = parseHTML(
      document_('.frame{max-width:640px;padding:0 24px;box-sizing:border-box}', wrapped()),
      schema,
    );
    expect(authoredPageBands(doc.child(0), schema, doc)?.stylesheet?.layout).toMatchObject({
      width: 640,
      inset: 24,
      phoneInset: 24,
    });
  });

  it('moves the wrapper’s colour to the column, and keeps a padding shorthand’s top and bottom', () => {
    mount(
      document_(
        '.frame{max-width:560px;padding:20px 32px 8px;background-color:#fafafa}',
        wrapped(),
      ),
    );
    expect(editor.exec(convertAuthoredPageToStylesheet(0))).toBe(true);
    expect(normalizePageLayout(editor.state.doc.attrs['pageLayout'])).toMatchObject({
      width: 624,
      inset: 32,
      columnBackground: '#fafafa',
    });
    expect(head(editor.getHTML())).toMatch(
      /\.frame\{\s*padding-top:20px;\s*padding-bottom:8px\s*\}/,
    );
  });

  for (const [name, html] of [
    ['a wrapper with no cap', document_('.frame{padding:0 24px}', wrapped())],
    ['uneven side room', document_('.frame{max-width:600px;padding:0 24px 0 8px}', wrapped())],
    ['a cap past the widest measure', document_('.frame{max-width:900px}', wrapped())],
    [
      'side room past the most a page takes',
      document_('.frame{max-width:500px;padding:0 80px}', wrapped()),
    ],
    ['a cap only in a selector list', document_('.frame,td{max-width:600px}', wrapped())],
    [
      'words beside the wrapper',
      document_(
        '.frame{max-width:600px}',
        wrapped().replace('<td align="center">', '<td align="center">Hi '),
      ),
    ],
  ]) {
    it(`offers nothing for ${name}`, () => {
      const doc = parseHTML(html, schema);
      expect(authoredPageBands(doc.child(0), schema, doc)?.shape).not.toBe('stylesheet-page');
    });
  }

  it('offers nothing beside another block', () => {
    mount(document_('.frame{max-width:600px}', `<div>before</div>${wrapped()}`));
    expect(editor.exec(convertAuthoredPageToStylesheet(editor.state.doc.child(0).nodeSize))).toBe(
      false,
    );
  });
});
