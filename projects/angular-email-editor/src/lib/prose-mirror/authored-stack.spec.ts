import { undo } from 'prosemirror-history';
import { Node } from 'prosemirror-model';
import { createEditor, Editor } from './editor';
import { emailExtensions } from './extensions/kits';
import { parseHTML, serializeToHTML } from './html';
import { authoredPageBands, convertAuthoredPageToRows, stackingClasses } from './authored-page';
import {
  authoredStackRow,
  authoredStackRowPositions,
  convertAuthoredStackRow,
} from './authored-stack';

const fs = (globalThis as any).process.getBuiltinModule('fs');
/** The catalogue's mail written by hand: a page of rows, its timeline four
    two-cell tables whose cells the head's phone rule stacks (`.stack`). */
const HAND_WRITTEN = fs.readFileSync(
  'projects/app/public/examples/html/hand-written.html',
  'utf8',
) as string;

/** A document whose head stacks `.stack` on a phone, round `body`. */
const mail = (
  body: string,
  sheet = '.stack { display: block !important; width: 100% !important; }',
) =>
  '<!doctype html><html><head><style>' +
  `@media only screen and (max-width: 620px) { ${sheet} }` +
  `</style></head><body>${body}</body></html>`;

/** A band of ours round `inside`: a section 600 wide with a 40px inset. */
const band = (inside: string) =>
  '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
  '<td style="padding: 0px;">' +
  `<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 40px; padding-right: 40px; box-sizing: border-box;">${inside}</div>` +
  '</td></tr></tbody></table>';

const ROW =
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #e9e9e9">' +
  '<tbody><tr>' +
  '<td class="stack" width="80" valign="top" style="padding: 24px 16px 24px 0; font-size: 22px; white-space: nowrap;">12.02.27</td>' +
  '<td class="stack" valign="top" style="padding: 24px 0"><p style="margin: 0">Early Access</p><p style="margin: 6px 0 0 0">Words</p></td>' +
  '</tr></tbody></table>';

describe('columns written by hand — offered as a columns block', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (content: string) => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
  };
  const positions = () => authoredStackRowPositions(editor.state.doc);
  const names = (node: Node) => {
    const found: string[] = [];
    node.forEach((child) => found.push(child.type.name));
    return found;
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it('reads the classes a head stacks on a phone, and no other', () => {
    const head =
      '<style>.a { display: block } @media (max-width: 620px) { .stack, td.cell { display: block !important } .px { padding: 0 } }</style>';
    expect([...stackingClasses(head)]).toEqual(['stack', 'cell']);
  });

  it('keeps the table as written on parse — nothing converted', () => {
    const html = mail(band(ROW));
    const doc = parseHTML(html, createEditorSchema());
    const out = serializeToHTML(doc, doc.type.schema);
    expect(out).toContain('class="stack"');
    expect(out).not.toContain('aee-layout-columns');
  });

  it('offers it where the row it stands in says its width, never on its own', () => {
    mount(mail(band(ROW)));
    const [pos] = positions();
    expect(pos).toBeGreaterThan(-1);
    const row = authoredStackRow(editor.state.doc.nodeAt(pos)!, editor.schema, editor.state.doc)!;
    expect(row.columns.map((column) => column.width)).toEqual([{ px: 80 }, null]);
    expect(row.top).toEqual({ height: 1, color: '#e9e9e9' });
    expect(row.bottom).toBeNull();
    // Loose in the body, nothing says how wide its row is.
    mount(mail(ROW));
    expect(positions()).toEqual([]);
  });

  it('converts when asked: a rule for the line, then the columns — one step, every word kept', () => {
    mount(mail(band(ROW)));
    const [pos] = positions();
    expect(editor.exec(convertAuthoredStackRow(pos))).toBe(true);
    const section = editor.state.doc.firstChild!;
    expect(names(section)).toEqual(['divider', 'columns']);
    const [first, second] = [section.child(1).child(0), section.child(1).child(1)];
    // The band's 600 less its insets: 520. The first cell's 80 is its
    // content's, its 16px of side padding beside it; the other takes the rest.
    expect(first.attrs['maxWidth']).toBe(96);
    expect(second.attrs['maxWidth']).toBe(424);
    expect(first.attrs['valign']).toBe('top');
    expect(first.attrs['padding']).toBe('24px 16px 24px 0px');
    expect(second.attrs['padding']).toBe('24px 0px');
    expect(first.textContent).toBe('12.02.27');
    expect(second.textContent).toBe('Early AccessWords');
    const html = editor.getHTML();
    // The cell's type on its words, the line as it was drawn.
    expect(html).toContain('font-size: 22px; white-space: nowrap;');
    expect(html).toContain('height: 1px; width: 100%; background-color: #e9e9e9;');
    expect(html).not.toContain('class="stack"');
    // Ours now: sent and read back, it is what it was.
    expect(serializeToHTML(parseHTML(html, editor.schema), editor.schema)).toBe(html);
    undo(editor.state, editor.view.dispatch);
    expect(names(editor.state.doc.firstChild!)).toEqual(['htmlElement']);
  });

  const cases: [string, string][] = [
    ['a head that stacks nothing', mail(band(ROW), '.px { padding: 0 !important; }')],
    ['one cell', mail(band(ROW.replace(/<td class="stack" valign[\s\S]*?<\/td>/, '')))],
    [
      'a cell of a class of its own',
      mail(band(ROW.replace('class="stack" width', 'class="stack date" width'))),
    ],
    ['a cell that does not stack', mail(band(ROW.replace('class="stack" valign', 'valign')))],
    [
      'a table with a fill',
      mail(band(ROW.replace('border-top: 1px solid #e9e9e9', 'background-color: #f7f7f7'))),
    ],
    [
      'a cell with corners',
      mail(band(ROW.replace('padding: 24px 0"', 'padding: 24px 0; border-radius: 8px"'))),
    ],
    [
      'two rows',
      mail(
        band(
          ROW.replace('</tr>', '</tr><tr><td class="stack">a</td><td class="stack">b</td></tr>'),
        ),
      ),
    ],
    ['cells wider than the row', mail(band(ROW.replace('width="80"', 'width="560"')))],
  ];
  for (const [name, html] of cases) {
    it(`makes no columns of ${name}`, () => {
      mount(html);
      expect(positions()).toEqual([]);
      editor.state.doc.descendants((_, pos) => {
        expect(editor.exec(convertAuthoredStackRow(pos))).toBe(false);
      });
    });
  }

  describe('in the mail written by hand', () => {
    const page = () => {
      let at = -1;
      editor.state.doc.forEach((node, pos) => {
        if (authoredPageBands(node, editor.schema)) at = pos;
      });
      return at;
    };

    it('offers the timeline once the page says its width: four rows of two columns', () => {
      mount(HAND_WRITTEN);
      // Inside the hand's page table, no row of ours says a width yet.
      expect(positions()).toEqual([]);
      expect(editor.exec(convertAuthoredPageToRows(page()))).toBe(true);
      expect(positions()).toHaveLength(4);
      // The header's two cells and the pill's are no such row: they do not stack.
      for (const pos of positions().reverse()) {
        expect(editor.exec(convertAuthoredStackRow(pos))).toBe(true);
      }
      expect(positions()).toEqual([]);
      const caps: number[][] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name !== 'columns') return true;
        const row: number[] = [];
        node.forEach((column) => row.push(column.attrs['maxWidth']));
        caps.push(row);
        return false;
      });
      // 600 less the row's 40px on each side.
      expect(caps).toEqual(Array(4).fill([96, 424]));
      expect(editor.state.doc.textContent).toContain('Einstellung des alten Frontends');
      const html = editor.getHTML();
      expect(serializeToHTML(parseHTML(html, editor.schema), editor.schema)).toBe(html);
    });
  });

  function createEditorSchema() {
    mount('<div>x</div>');
    return editor.schema;
  }
});
