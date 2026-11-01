import { undo } from 'prosemirror-history';
import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { parseHTML, serializeToHTML } from './html';
import { authoredPageBands, convertAuthoredPageToCentred } from './authored-page';
import { centeredPageLayout, normalizePageLayout } from './page-layout';
import { createSchema } from './schema';

const fs = (globalThis as any).process.getBuiltinModule('fs');
/** MJML's Appointment Alert: five bands, each centring itself at 600px. */
const ALERT = fs.readFileSync(
  'projects/app/public/examples/mjml/appointment-alert.html',
  'utf8',
) as string;

const schema = createSchema(emailExtensions);
const band = (width: number, words = 'x') =>
  `<div style="background:#F4F9FF;background-color:#F4F9FF;margin:0px auto;max-width:${width}px;"><table width="100%"><tbody><tr><td>${words}</td></tr></tbody></table></div>`;
const page = (inside: string) =>
  `<div style="word-spacing:normal;background-color:#eef2f7;">${inside}</div>`;

describe('a centred column written band by band — offered as a centred page', () => {
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
    const doc = parseHTML(ALERT, schema);
    expect(doc.attrs['pageLayout']).toBeNull();
    expect(serializeToHTML(doc, schema)).toContain('margin:0px auto;max-width:600px;');
  });

  it('recognises Appointment Alert: its five bands, 600px, on the wrapper’s white', () => {
    const doc = parseHTML(ALERT, schema);
    const conversion = authoredPageBands(doc.child(0), schema)!;
    expect(conversion.shape).toBe('centred-bands');
    expect(conversion.html).toBeNull();
    expect(conversion.rows).toBeNull();
    expect(conversion.centred!.bands).toBe(5);
    expect(conversion.centred!.layout).toEqual(
      centeredPageLayout({
        width: 600,
        background: '#ffffff',
        columnBackground: null,
        spacing: 0,
        inset: 0,
      }),
    );
  });

  it('converted: our centred page, the bands without their own centring, all else as written — one undo step', () => {
    mount(ALERT);
    const before = editor.getHTML();
    expect(editor.exec(convertAuthoredPageToCentred(0))).toBe(true);
    const doc = editor.state.doc;
    expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(
      centeredPageLayout({
        width: 600,
        background: '#ffffff',
        columnBackground: null,
        spacing: 0,
        inset: 0,
      }),
    );
    const html = editor.getHTML();
    expect(html).toContain('aee-layout-page');
    expect(html).not.toContain('margin:0px auto;max-width:600px;');
    // A band keeps every other declaration as written: its fill, its corners.
    expect(html).toContain('background:#F4F9FF;background-color:#F4F9FF');
    expect(html).toContain('border-radius:0px 0px 30px 30px');
    expect(doc.textContent).toContain('Hello there!');
    // Read back, it is the same page of ours.
    const again = parseHTML(html, schema);
    expect(normalizePageLayout(again.attrs['pageLayout'])?.width).toBe(600);
    expect(serializeToHTML(again, schema)).toBe(html);
    // Asked twice, it is no longer offered.
    expect(editor.exec(convertAuthoredPageToCentred(0))).toBe(false);
    undo(editor.state, editor.view.dispatch);
    expect(editor.getHTML()).toBe(before);
  });

  it('keeps a band’s vertical margin, dropping only its side centring', () => {
    mount(page(band(600).replace('margin:0px auto', 'margin:20px auto') + band(600)));
    editor.exec(convertAuthoredPageToCentred(0));
    expect(editor.getHTML()).toContain('margin:20px 0px 20px');
  });

  for (const [name, html] of [
    ['bands of two widths', page(band(600) + band(500))],
    ['one band alone', page(band(600))],
    ['words beside the bands', page(`Hi ${band(600)}${band(600)}`)],
    ['a band past the widest measure', page(band(1200) + band(1200))],
    ['a band not centred', page(band(600).replace('margin:0px auto', 'margin:0px') + band(600))],
  ]) {
    it(`offers nothing for ${name}`, () => {
      const doc = parseHTML(html, schema);
      expect(authoredPageBands(doc.child(0), schema)?.shape).not.toBe('centred-bands');
    });
  }

  it('offers nothing beside another block, or over a page layout', () => {
    mount(`<div>before</div>${page(band(600) + band(600))}`);
    expect(editor.exec(convertAuthoredPageToCentred(1))).toBe(false);
  });
});
