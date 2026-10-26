import { Node } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { clickBelow } from './extensions/click-below';
import { pageLayoutOf } from './extensions/page-layout';
import { parseHTML, serializeToHTML } from './html';
import { centeredPageLayout, normalizePageLayout, tablePageLayout } from './page-layout';

/** The page of rows (page-layout.ts, the `table` kind): every line in a
    row, the column a table, the hand-coded form recognised and marked. */
describe('page of rows', () => {
  let host: HTMLElement;
  let editor: Editor;

  const fs = (globalThis as any).process.getBuiltinModule('fs');
  const EXAMPLES = 'projects/app/public/examples/';
  /** The catalogue's hand-coded page: a 100% table round a 600px table of
      one-cell rows, unmarked. */
  const WELCOME: string = fs.readFileSync(`${EXAMPLES}angularjs/welcome.html`, 'utf8');

  const BAND =
    '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
    '<td bgcolor="#e8f0fe" style="padding: 20px 0px; background-color: rgb(232, 240, 254); color: rgb(32, 33, 36);">' +
    '<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;"><div>band</div></div>' +
    '</td></tr></tbody></table>';
  const BODY = `<div>before</div>${BAND}<div>after</div>`;

  const mount = (content: string, parseMode: 'repair' | 'preserve' | 'email' = 'preserve') => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content, parseMode });
  };
  const top = (doc: Node = editor.state.doc) => {
    const names: string[] = [];
    doc.forEach((node) => names.push(node.type.name));
    return names;
  };
  const rows = (html: string) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    const column = template.content.querySelector('.aee-layout-page-column') as HTMLTableElement;
    return { column, cells: Array.from(column.rows, (row) => row.cells[0]) };
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

  describe('recognising the hand-coded page', () => {
    for (const mode of ['repair', 'email', 'preserve'] as const) {
      it(`lifts it as a page of rows in the ${mode} parse, each row a band`, () => {
        const doc = parseHTML(WELCOME, editor.schema, { mode });
        expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(
          tablePageLayout({
            width: 600,
            background: '#eef2f7',
            columnBackground: '#ffffff',
            spacing: 32,
          }),
        );
        expect(top(doc)).toEqual(Array(6).fill('section'));
        const fills: (string | null)[] = [];
        const paddings: string[] = [];
        doc.forEach((row) => {
          fills.push(row.attrs['background']);
          paddings.push(row.attrs['padding']);
        });
        expect(fills).toEqual(['#1f3a5f', null, null, null, null, '#f1f3f4']);
        // The row's sides are the column's inset now: above and below kept.
        expect(paddings).toEqual([
          '24px 0px',
          '32px 0px 8px',
          '8px 0px',
          '8px 0px',
          '24px 0px 32px',
          '24px 0px',
        ]);
        expect(doc.textContent).toContain('Welcome to');
        expect(doc.child(4).firstChild!.firstChild!.type.name).toBe('button');
      });
    }

    it('sends it marked — and reads the marked form back as it sent it', () => {
      mount(WELCOME);
      const html = editor.getHTML();
      expect(html.startsWith('<table class="aee-layout-page"')).toBe(true);
      const { column, cells } = rows(html);
      expect(column.tagName).toBe('TABLE');
      expect(column.style.maxWidth).toBe('600px');
      expect(cells.map((cell) => cell.className)).toEqual(Array(6).fill('aee-layout-section'));
      expect(cells[0].getAttribute('bgcolor')).toBe('#1f3a5f');
      for (const mode of ['email', 'preserve'] as const) {
        const doc = parseHTML(html, editor.schema, { mode });
        expect(serializeToHTML(doc, editor.schema)).toBe(html);
      }
      // Repair writes the words its canonical way — and then holds still.
      const repaired = serializeToHTML(parseHTML(html, editor.schema), editor.schema);
      expect(rows(repaired).cells.map((cell) => cell.className)).toEqual(
        Array(6).fill('aee-layout-section'),
      );
      expect(serializeToHTML(parseHTML(repaired, editor.schema), editor.schema)).toBe(repaired);
    });

    it("keeps the row's words and their styles in a block", () => {
      mount(WELCOME);
      const { cells } = rows(editor.getHTML());
      const heading = cells[1].querySelector('div > div') as HTMLElement;
      expect(heading.textContent).toContain('Welcome to');
      expect(heading.style.fontSize).toBe('24px');
      expect(heading.style.fontWeight).toBe('bold');
      // The column's font, handed down to every row.
      expect(heading.style.fontFamily).toContain('Arial');
      const button = cells[4].querySelector('div > div') as HTMLElement;
      expect(button.style.textAlign).toBe('center');
      // The column's and the header's text colours are their fills' pairs —
      // not the words' to keep; the footer's grey is authored, and kept.
      expect(heading.style.color).toBe('');
      expect((cells[0].querySelector('div > div') as HTMLElement).style.color).toBe('');
      expect((cells[5].querySelector('div > div') as HTMLElement).style.color).toBe(
        'rgb(95, 99, 104)',
      );
    });

    const page = (column: string, attrs = 'bgcolor="#eef2f7"') =>
      `<table role="presentation" width="100%" ${attrs}><tbody><tr><td align="center">${column}</td></tr></tbody></table>`;
    const COLUMN = '<table width="600"><tbody><tr><td>One</td></tr><tr><td>Two</td></tr></tbody></table>';
    const cases: [string, string][] = [
      ['a row of two cells', page('<table width="600"><tbody><tr><td>One</td><td>Two</td></tr></tbody></table>')],
      ['a column as wide as its room', page(COLUMN.replace('width="600"', 'width="100%"'))],
      ['a column past the widest measure', page(COLUMN.replace('width="600"', 'width="1200"'))],
      ['no fill on page or column', page(COLUMN, '')],
      ['a block beside the page', `<div>Hello</div>${page(COLUMN)}`],
      ['words beside the column', page(`Hi ${COLUMN}`)],
    ];
    for (const [name, html] of cases) {
      it(`is no page for ${name}`, () => {
        const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
        expect(doc.attrs['pageLayout']).toBeNull();
      });
    }

    it('takes the page as it is — through wrappers, round a column of the minimum width', () => {
      const html = `<div><center>${page(COLUMN.replace('width="600"', 'width="320"'))}</center></div>`;
      const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.kind).toBe('table');
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.width).toBe(320);
      expect(top(doc)).toEqual(['section', 'section']);
    });
  });

  describe('in the editor', () => {
    const toRows = () => {
      editor.commands['setPageLayout'](centeredPageLayout());
      return editor.commands['setPageLayout'](tablePageLayout());
    };

    it('turns a free column into rows: each run a plain row, each band a filled one', () => {
      expect(toRows()).toBe(true);
      expect(top()).toEqual(['section', 'section', 'section']);
      const [before, band, after] = [0, 1, 2].map((i) => editor.state.doc.child(i));
      expect(before.attrs['background']).toBeNull();
      expect(before.attrs['padding']).toBe('16px 0px');
      expect(before.textContent).toBe('before');
      expect(band.attrs['background']).toBe('#e8f0fe');
      expect(after.textContent).toBe('after');
    });

    it('takes the page and its rows back in one undo', () => {
      toRows();
      expect(editor.commands['undo']()).toBe(true);
      expect(pageLayoutOf(editor.state)?.kind).toBe('centered');
      expect(top()).toEqual(['paragraph', 'section', 'paragraph']);
    });

    it('never goes back to a free column, nor to no page', () => {
      toRows();
      expect(editor.commands['setPageLayout'](centeredPageLayout())).toBe(false);
      expect(editor.commands['setPageLayout'](null)).toBe(false);
      expect(pageLayoutOf(editor.state)?.kind).toBe('table');
      // Its own measures still change.
      expect(editor.commands['setPageLayout'](tablePageLayout({ width: 640 }))).toBe(true);
      expect(pageLayoutOf(editor.state)?.width).toBe(640);
    });

    it('keeps a new line in its row', () => {
      toRows();
      const end = editor.state.doc.content.size - 2;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
      const enter = new KeyboardEvent('keydown', { key: 'Enter' });
      expect(editor.view.someProp('handleKeyDown', (f) => f(editor.view, enter))).toBe(true);
      editor.view.dispatch(editor.state.tr.insertText('more'));
      expect(top()).toEqual(['section', 'section', 'section']);
      expect(editor.state.doc.lastChild!.childCount).toBe(2);
      expect(editor.state.doc.lastChild!.textContent).toBe('aftermore');
    });

    it('puts what lands between rows into a row of its own', () => {
      toRows();
      const paragraph = editor.schema.nodes['paragraph'].create(null, editor.schema.text('pasted'));
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.child(0).nodeSize, paragraph));
      expect(top()).toEqual(['section', 'section', 'section', 'section']);
      expect(editor.state.doc.child(1).textContent).toBe('pasted');
    });

    it('starts a click-below line in the last row', () => {
      toRows();
      editor.view.dispatch(
        editor.state.tr.setSelection(Selection.atStart(editor.state.doc)),
      );
      expect(clickBelow(editor.view, 10)).toBe(true);
      expect(top()).toEqual(['section', 'section', 'section']);
      const { $from } = editor.state.selection;
      expect($from.node(1)).toBe(editor.state.doc.lastChild);
      expect($from.parent.content.size).toBe(0);
    });

    it('sends the rows and reads them back as they were', () => {
      toRows();
      const html = editor.getHTML();
      expect(rows(html).cells.map((cell) => cell.className)).toEqual(
        Array(3).fill('aee-layout-section'),
      );
      const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
      expect(doc.eq(editor.state.doc)).toBe(true);
    });
  });

  // Every catalogue template turned into rows reads back as it was sent.
  const examples: string[] = JSON.parse(fs.readFileSync(`${EXAMPLES}index.json`, 'utf8'))
    .sets.flatMap((set: { examples: { file: string }[] }) => set.examples)
    .map((example: { file: string }) => example.file)
    .filter((file: string) => file.endsWith('.html'));
  for (const file of examples) {
    it(`round-trips ${file} as rows`, () => {
      mount(fs.readFileSync(`${EXAMPLES}${file}`, 'utf8'));
      editor.commands['setPageLayout'](tablePageLayout({ width: 640 }));
      const html = editor.getHTML();
      const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.kind).toBe('table');
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
    });
  }
});
