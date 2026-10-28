import { Node } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { clickBelow } from './extensions/click-below';
import { pageLayoutOf } from './extensions/page-layout';
import { parseHTML, serializeToHTML } from './html';
import { centeredPageLayout, normalizePageLayout, tablePageLayout } from './page-layout';
import { sectionPaddingOf } from './extensions/nodes/section';

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
      it(`lifts it as a page of rows in the ${mode} parse, each row a row of ours`, () => {
        const doc = parseHTML(WELCOME, editor.schema, { mode });
        expect(normalizePageLayout(doc.attrs['pageLayout'])).toEqual(
          tablePageLayout({
            width: 600,
            background: '#eef2f7',
            columnBackground: '#ffffff',
            spacing: 32,
            // Its column's `cellpadding="0"`: every row says its own.
            rowPadding: 0,
          }),
        );
        expect(top(doc)).toEqual(Array(6).fill('pageRow'));
        const fills: (string | null)[] = [];
        const paddings: string[] = [];
        doc.forEach((row) => {
          fills.push(row.attrs['background']);
          paddings.push(row.attrs['padding']);
        });
        expect(fills).toEqual(['#1f3a5f', null, null, null, null, '#f1f3f4']);
        // Each cell's own padding, all four sides.
        expect(paddings).toEqual([
          '24px',
          '32px 32px 8px',
          '8px 32px',
          '8px 32px',
          '24px 32px 32px',
          '24px 32px',
        ]);
        // Rows of ours, as they emit — none kept as authored markup.
        doc.forEach((row) => expect(row.attrs['html'] ?? null).toBeNull());
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
      expect(cells.map((cell) => cell.className)).toEqual(Array(6).fill('aee-layout-page-row'));
      expect(cells[0].getAttribute('bgcolor')).toBe('#1f3a5f');
      for (const mode of ['email', 'preserve'] as const) {
        const doc = parseHTML(html, editor.schema, { mode });
        expect(serializeToHTML(doc, editor.schema)).toBe(html);
      }
      // Repair writes the words its canonical way — and then holds still.
      const repaired = serializeToHTML(parseHTML(html, editor.schema), editor.schema);
      expect(rows(repaired).cells.map((cell) => cell.className)).toEqual(
        Array(6).fill('aee-layout-page-row'),
      );
      expect(serializeToHTML(parseHTML(repaired, editor.schema), editor.schema)).toBe(repaired);
    });

    it("keeps the row's words and their styles in a block", () => {
      mount(WELCOME);
      const { cells } = rows(editor.getHTML());
      const heading = cells[1].firstElementChild as HTMLElement;
      expect(heading.textContent).toContain('Welcome to');
      expect(heading.style.fontSize).toBe('24px');
      expect(heading.style.fontWeight).toBe('bold');
      // The column's font, handed down to every row.
      expect(heading.style.fontFamily).toContain('Arial');
      const button = cells[4].firstElementChild as HTMLElement;
      expect(button.style.textAlign).toBe('center');
      // The column's and the header's text colours are their fills' pairs —
      // not the words' to keep; the footer's grey is authored, and kept.
      expect(heading.style.color).toBe('');
      expect((cells[0].firstElementChild as HTMLElement).style.color).toBe('');
      expect((cells[5].firstElementChild as HTMLElement).style.color).toBe('rgb(95, 99, 104)');
    });

    const page = (column: string, attrs = 'bgcolor="#eef2f7"') =>
      `<table role="presentation" width="100%" ${attrs}><tbody><tr><td align="center">${column}</td></tr></tbody></table>`;
    const COLUMN =
      '<table width="600"><tbody><tr><td>One</td></tr><tr><td>Two</td></tr></tbody></table>';
    const cases: [string, string][] = [
      [
        'a row of two cells',
        page('<table width="600"><tbody><tr><td>One</td><td>Two</td></tr></tbody></table>'),
      ],
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

    it("takes the column's cellpadding as the page's row padding", () => {
      const column =
        '<table width="600" cellpadding="12"><tbody><tr><td>One</td></tr><tr><td style="padding: 4px;">Two</td></tr></tbody></table>';
      const doc = parseHTML(page(column), editor.schema, { mode: 'preserve' });
      expect((normalizePageLayout(doc.attrs['pageLayout']) as any).rowPadding).toBe(12);
      expect(doc.child(0).attrs['padding']).toBeNull();
      expect(doc.child(1).attrs['padding']).toBe('4px');
    });

    // A marked page edited by hand: our rows copied straight into the page
    // table, beside a free column left with one empty run.
    const STRAY =
      '<table class="aee-layout-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody>' +
      '<tr><td bgcolor="#efe9e1" style="padding: 32px 0px; background-color: rgb(239, 233, 225); color: rgb(32, 33, 36);">' +
      '<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->' +
      '<div class="aee-layout-page-column" style="max-width: 600px; margin: 0px auto;"><div class="aee-layout-page-run" style="padding: 16px;"></div></div></td></tr>' +
      '<tr><td class="aee-layout-page-row" bgcolor="#ffffff" style="padding: 36px 40px 18px; background-color: rgb(255, 255, 255); color: rgb(32, 33, 36);"><div>Masthead</div></td></tr>' +
      '<tr><td class="aee-layout-page-row" bgcolor="#ffffff" style="padding: 0px 40px 28px; background-color: rgb(255, 255, 255); color: rgb(32, 33, 36);">' +
      '<table role="presentation" width="100%"><tbody><tr><td>Aktenzeichen</td><td>{{ case_number }}</td></tr></tbody></table></td></tr>' +
      '<tr><td class="aee-layout-page-row" style="padding: 20px 40px;"><div>Footer</div></td></tr>' +
      '<!--[if mso]></td></tr></table><![endif]-->' +
      '</tbody></table>';
    for (const mode of ['repair', 'email', 'preserve'] as const) {
      it(`reads a hand-edited page as authored markup in the ${mode} parse — no layout, nothing dropped`, () => {
        const doc = parseHTML(STRAY, editor.schema, { mode });
        // Its rows were never in the 600px column: no page width is theirs.
        expect(doc.attrs['pageLayout']).toBeNull();
        expect(top(doc)).not.toContain('pageRow');
        expect(doc.textContent).toContain('Masthead');
        expect(doc.textContent).toContain('Aktenzeichen');
        expect(doc.textContent).toContain('Footer');
      });
    }

    it('sends a hand-edited page as it stands, its rows as wide as the room, none of our markers on it', () => {
      mount(STRAY);
      const html = editor.getHTML();
      expect(html).not.toContain('aee-layout-page');
      expect(html).toContain('width="100%"');
      expect(html).toContain('padding: 36px 40px 18px');
      expect(html).toContain('Footer');
    });

    it('takes the page as it is — through wrappers, round a column of the minimum width', () => {
      const html = `<div><center>${page(COLUMN.replace('width="600"', 'width="320"'))}</center></div>`;
      const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.kind).toBe('table');
      expect(normalizePageLayout(doc.attrs['pageLayout'])?.width).toBe(320);
      expect(top(doc)).toEqual(['pageRow', 'pageRow']);
    });
  });

  describe('in the editor', () => {
    const toRows = () => {
      editor.commands['setPageLayout'](centeredPageLayout());
      return editor.commands['setPageLayout'](tablePageLayout());
    };
    const toStart = () =>
      editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)));

    it('turns a free column into rows: each run a plain row, each band a coloured one', () => {
      expect(toRows()).toBe(true);
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow']);
      const [before, band, after] = [0, 1, 2].map((i) => editor.state.doc.child(i));
      expect(before.attrs['background']).toBeNull();
      // The page's padding, not one of its own.
      expect(before.attrs['padding']).toBeNull();
      expect(before.textContent).toBe('before');
      expect(band.attrs['background']).toBe('#e8f0fe');
      // The band's room above and below, its inset at the sides.
      expect(band.attrs['padding']).toBe('20px 16px');
      expect(after.textContent).toBe('after');
    });

    it('takes the page and its rows back in one undo', () => {
      toRows();
      expect(editor.commands['undo']()).toBe(true);
      expect(pageLayoutOf(editor.state)?.kind).toBe('centered');
      expect(top()).toEqual(['paragraph', 'section', 'paragraph']);
    });

    it('turns rows back into a free column: a coloured row a band, a plain row its blocks', () => {
      editor.commands['setPageLayout'](centeredPageLayout());
      const centred = editor.getHTML();
      toRows();
      expect(editor.commands['setPageLayout'](centeredPageLayout())).toBe(true);
      expect(top()).toEqual(['paragraph', 'section', 'paragraph']);
      expect(editor.getHTML()).toBe(centred);
    });

    it('turns rows into no page at all the same way', () => {
      toRows();
      expect(editor.commands['setPageLayout'](null)).toBe(true);
      expect(pageLayoutOf(editor.state)).toBeNull();
      expect(top()).toEqual(['paragraph', 'section', 'paragraph']);
      expect(editor.getHTML()).toBe(BODY);
    });

    it('keeps a new line in its row', () => {
      toRows();
      const end = editor.state.doc.content.size - 2;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
      );
      const enter = new KeyboardEvent('keydown', { key: 'Enter' });
      expect(editor.view.someProp('handleKeyDown', (f) => f(editor.view, enter))).toBe(true);
      editor.view.dispatch(editor.state.tr.insertText('more'));
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow']);
      expect(editor.state.doc.lastChild!.childCount).toBe(2);
      expect(editor.state.doc.lastChild!.textContent).toBe('aftermore');
    });

    it('puts what lands between rows into a row of its own', () => {
      toRows();
      const paragraph = editor.schema.nodes['paragraph'].create(null, editor.schema.text('pasted'));
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.child(0).nodeSize, paragraph));
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow', 'pageRow']);
      expect(editor.state.doc.child(1).textContent).toBe('pasted');
    });

    it('starts a new plain row on a click below the rows', () => {
      toRows();
      toStart();
      expect(clickBelow(editor.view, 10)).toBe(true);
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow', 'pageRow']);
      const row = editor.state.doc.lastChild!;
      expect(row.attrs['background']).toBeNull();
      expect(row.attrs['padding']).toBeNull();
      expect(editor.state.selection.$from.node(1)).toBe(row);
      editor.view.dispatch(editor.state.tr.insertText('new row'));
      expect(editor.state.doc.lastChild!.textContent).toBe('new row');
      expect(rows(editor.getHTML()).cells.at(-1)!.textContent).toBe('new row');
    });

    it('takes an unused new row away again, and reuses a blank one', () => {
      toRows();
      toStart();
      clickBelow(editor.view, 10);
      expect(clickBelow(editor.view, 10)).toBe(true);
      expect(top()).toHaveLength(4);
      toStart();
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow']);
    });

    it('turns the row the cursor is in into a band on /section — nothing added', () => {
      toRows();
      toStart();
      expect(editor.commands['insertSection']('#e6f4ea')).toBe(true);
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow']);
      expect(editor.state.doc.child(0).attrs['background']).toBe('#e6f4ea');
      expect(editor.state.doc.child(0).textContent).toBe('before');
      // As a band, it stays one going back to a free column.
      editor.commands['setPageLayout'](centeredPageLayout());
      expect(top()).toEqual(['section', 'section', 'paragraph']);
    });

    it("takes the band commands on a band row: its colour, its image, and Remove", () => {
      toRows();
      toStart();
      // A plain row is no band: nothing to colour through them yet.
      expect(editor.commands['setSectionBackground']('#e6f4ea')).toBe(false);
      editor.commands['insertSection']();
      expect(editor.commands['setSectionBackground']('#fce8e6')).toBe(true);
      expect(editor.state.doc.child(0).attrs['background']).toBe('#fce8e6');
      expect(editor.commands['setSectionImage']('javascript:alert(1)')).toBe(false);
      expect(editor.commands['setSectionImage']('https://example.com/hero.jpg')).toBe(true);
      const html = editor.getHTML();
      const cell = rows(html).cells[0];
      expect(cell.style.backgroundImage).toContain('https://example.com/hero.jpg');
      expect(cell.getAttribute('bgcolor')).toBe('#fce8e6');
      // Read back as it was sent.
      const doc = parseHTML(html, editor.schema, { mode: 'preserve' });
      expect(doc.child(0).attrs['image']).toBe('https://example.com/hero.jpg');
      expect(serializeToHTML(doc, editor.schema)).toBe(html);
      // Remove: a plain row, its words kept.
      expect(editor.commands['removeSection']()).toBe(true);
      expect(top()).toEqual(['pageRow', 'pageRow', 'pageRow']);
      expect(editor.state.doc.child(0).attrs['background']).toBeNull();
      expect(editor.state.doc.child(0).attrs['image']).toBeNull();
      expect(editor.state.doc.child(0).textContent).toBe('before');
    });

    it('keeps a band row image going to a free column and back', () => {
      toRows();
      toStart();
      editor.commands['insertSection']('#fce8e6');
      editor.commands['setSectionImage']('https://example.com/hero.jpg');
      editor.commands['setPageLayout'](centeredPageLayout());
      expect(editor.state.doc.child(0).type.name).toBe('section');
      expect(editor.state.doc.child(0).attrs['image']).toBe('https://example.com/hero.jpg');
      editor.commands['setPageLayout'](tablePageLayout());
      expect(editor.state.doc.child(0).type.name).toBe('pageRow');
      expect(editor.state.doc.child(0).attrs['image']).toBe('https://example.com/hero.jpg');
    });

    it("sets a band row's room on its own four sides, from the page's, and keeps it going to a free column and back", () => {
      toRows();
      toStart();
      editor.commands['insertSection']('#fce8e6');
      expect(sectionPaddingOf(editor.state)).toEqual({ block: 16, inline: 16 });
      editor.commands['setSectionPadding']({ block: 32, inline: 8 });
      expect(editor.state.doc.child(0).attrs['padding']).toBe('32px 8px');
      expect(sectionPaddingOf(editor.state)).toEqual({ block: 32, inline: 8 });
      // A band: its padding above and below, its sides the inset.
      editor.commands['setPageLayout'](centeredPageLayout());
      expect(editor.state.doc.child(0).attrs['padding']).toBe('32px 0px');
      expect(editor.state.doc.child(0).attrs['inset']).toBe(8);
      editor.commands['setPageLayout'](tablePageLayout());
      expect(editor.state.doc.child(0).attrs['padding']).toBe('32px 8px');
    });

    it('draws a row as a plain block — no band, no table', () => {
      toRows();
      const dom = editor.view.dom;
      expect(dom.querySelectorAll(':scope > .aee-page-row')).toHaveLength(3);
      expect(dom.querySelector('.aee-section, table')).toBeNull();
    });

    it("gives every row without a padding of its own the page's, as the column's cellpadding", () => {
      toRows();
      expect(tablePageLayout().rowPadding).toBe(16);
      let sent = rows(editor.getHTML());
      expect(sent.column.getAttribute('cellpadding')).toBe('16');
      // A plain row says no padding; the band turned row keeps its own.
      expect(sent.cells[0].style.padding).toBe('');
      expect(sent.cells[1].style.padding).toBe('20px 16px');
      expect(editor.commands['setPageLayout'](tablePageLayout({ rowPadding: 24 }))).toBe(true);
      sent = rows(editor.getHTML());
      expect(sent.column.getAttribute('cellpadding')).toBe('24');
      // The editor draws it off the root's custom property.
      expect(editor.view.dom.style.getPropertyValue('--aee-page-row-padding')).toBe('24px');
      expect((editor.view.dom.firstElementChild as HTMLElement).style.padding).toContain(
        'var(--aee-page-row-padding',
      );
      // And reads it back off the column.
      const doc = parseHTML(editor.getHTML(), editor.schema, { mode: 'preserve' });
      expect((normalizePageLayout(doc.attrs['pageLayout']) as any).rowPadding).toBe(24);
      expect(doc.child(0).attrs['padding']).toBeNull();
    });

    it("keeps the page's padding on a row turned band, going back to a free column", () => {
      editor.commands['setPageLayout'](centeredPageLayout());
      editor.commands['setPageLayout'](tablePageLayout({ rowPadding: 8 }));
      toStart();
      editor.commands['insertSection']('#e6f4ea');
      editor.commands['setPageLayout'](centeredPageLayout());
      expect(editor.state.doc.child(0).type.name).toBe('section');
      expect(editor.state.doc.child(0).attrs['padding']).toBe('8px 0px');
    });

    it('sends the rows and reads them back as they were', () => {
      toRows();
      const html = editor.getHTML();
      expect(rows(html).cells.map((cell) => cell.className)).toEqual(
        Array(3).fill('aee-layout-page-row'),
      );
      expect(rows(html).cells[1].getAttribute('bgcolor')).toBe('#e8f0fe');
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
