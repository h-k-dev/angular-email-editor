import { Node } from 'prosemirror-model';
import { createEditor } from './editor';
import { emailExtensions } from './extensions/kits';
import { layoutBlockInteractive } from './extensions/layout-interaction';
import { markStackingColumns } from '@h-k-dev/dawn';
import { tableKind } from './extensions/nodes/table';
import { parseHTML, serializeToHTML } from './html';
import { isMarked, layoutMarker, markedAs, withoutMarkers } from './layout-marker';
import { createSchema } from './schema';

const schema = createSchema(emailExtensions);
type Mode = 'repair' | 'email' | 'preserve';
const parse = (html: string, mode: Mode = 'repair') => parseHTML(html, schema, { mode });
const canonical = (html: string, mode: Mode = 'repair') =>
  serializeToHTML(parse(html, mode), schema);
const element = (html: string): Element => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild!;
};
const first = (doc: Node, type: string): Node => {
  let found: Node | null = null;
  doc.descendants((node) => {
    if (!found && node.type.name === type) found = node;
    return !found;
  });
  return found!;
};

const COLUMN =
  'display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;';

describe('layout markers', () => {
  describe('reading', () => {
    it('names the kind a class marks — ours, or renamed by a client on the way', () => {
      expect(markedAs(element('<table class="aee-layout-section"></table>'))).toBe('section');
      // Outlook.com's prefix, Gmail's (signed digits), among other classes.
      expect(markedAs(element('<div class="x x_aee-layout-column"></div>'))).toBe('column');
      expect(markedAs(element('<ul class="m_-123456789aee-layout-list y"></ul>'))).toBe('list');
      expect(markedAs(element('<h2 class="m_42aee-layout-heading"></h2>'))).toBe('heading');
      expect(markedAs(element('<div class="aee-layout-nothing"></div>'))).toBeNull();
      expect(markedAs(element('<div class="aee-columns"></div>'))).toBeNull();
      expect(isMarked(element('<table class="aee-layout-table"></table>'), 'table')).toBe(true);
      expect(isMarked(element('<table class="aee-layout-table"></table>'), 'section')).toBe(false);
    });

    it('takes every marker out of a class, and only them', () => {
      expect(withoutMarkers('a aee-layout-section x_aee-layout-table b')).toBe('a b');
      expect(withoutMarkers(layoutMarker('columns'))).toBe('');
    });
  });

  describe('writing — every block with a layout variant says what it is', () => {
    let editor: ReturnType<typeof createEditor>;

    beforeEach(() => {
      editor = createEditor({ parent: document.createElement('div'), extensions: emailExtensions });
    });

    afterEach(() => editor.destroy());

    it('a section, a columns block and its columns, a layout table', () => {
      editor.commands['insertSection']('#f1f3f4');
      expect(editor.getHTML()).toContain('<table class="aee-layout-section" role="presentation"');
      editor.setContent('<div>x</div>');
      editor.commands['insertColumns'](2);
      const columns = editor.getHTML();
      expect(columns).toContain('<div class="aee-layout-columns" style=');
      expect(columns.match(/<div class="aee-layout-column" style=/g)).toHaveLength(2);
      editor.setContent('<div>x</div>');
      editor.commands['insertTable'](2, 2, 'layout');
      expect(editor.getHTML()).toContain('<table class="aee-layout-table" role="presentation"');
    });

    it('a content table carries none — and no presentation role: it is data', () => {
      for (const kind of ['bordered', 'borderless']) {
        editor.setContent('<div>x</div>');
        editor.commands['insertTable'](2, 2, kind);
        const html = editor.getHTML();
        expect(html).not.toContain('aee-layout');
        expect(html).not.toContain('role="presentation"');
      }
    });

    it('a heading or a list only in its layout variant', () => {
      expect(canonical('<h2 style="margin: 0">t</h2>')).toContain('<h2 class="aee-layout-heading"');
      expect(canonical('<h2>t</h2>')).not.toContain('aee-layout');
      expect(canonical('<ul style="margin: 0"><li><div>a</div></li></ul>')).toContain(
        '<ul class="aee-layout-list"',
      );
      expect(canonical('<ol><li><div>a</div></li></ol>')).not.toContain('aee-layout');
    });
  });

  describe('parsing — the marker wins over the shape', () => {
    for (const mode of ['repair', 'email', 'preserve'] as const) {
      describe(`in ${mode} mode`, () => {
        it('a marked heading or list is a layout one, whatever its margin', () => {
          expect(
            first(parse('<h2 class="aee-layout-heading">t</h2>', mode), 'heading').attrs['layout'],
          ).toBe(true);
          expect(
            first(
              parse('<ul class="aee-layout-list"><li><div>a</div></li></ul>', mode),
              'bulletList',
            ).attrs['layout'],
          ).toBe(true);
        });

        it('a marked table is a layout table, lines and room or not', () => {
          const html =
            '<table class="aee-layout-table" style="margin-top: 16px; margin-bottom: 16px;"><tbody><tr>' +
            '<td style="border: 1px solid rgb(218, 220, 224);">a</td><td>b</td></tr></tbody></table>';
          expect(tableKind(first(parse(html, mode), 'table'))).toBe('layout');
        });

        it('our own marked output comes back as itself', () => {
          editorOutputs().forEach((html) => expect(canonical(html, mode)).toBe(html));
        });
      });
    }

    it('a marked band is a section even bare — no fill, no image, no padding', () => {
      const bare =
        '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
        '<td><div><div>band</div></div></td></tr></tbody></table>';
      expect(first(parse(bare), 'section')).toBeTruthy();
      // Unmarked, the same bare band is a table, as it always was.
      expect(first(parse(bare.replace(' class="aee-layout-section"', '')), 'section')).toBeNull();
    });

    it('a marked column is one without the inline-block it would need unmarked', () => {
      const html =
        '<div class="aee-layout-columns"><div class="aee-layout-column" style="max-width: 280px;"><div>a</div></div>' +
        '<div class="aee-layout-column" style="max-width: 280px;"><div>b</div></div></div>';
      expect(first(parse(html), 'columns').childCount).toBe(2);
    });

    it('another kind’s marker stops a shape match: a marked layout table is never a band', () => {
      const html =
        '<table class="aee-layout-table" role="presentation"><tbody><tr><td bgcolor="#f1f3f4"><div>a</div></td></tr></tbody></table>';
      expect(first(parse(html), 'section')).toBeNull();
      expect(tableKind(first(parse(html), 'table'))).toBe('layout');
    });

    it('markup from before the markers is still exactly ours in preserve mode — and comes out marked', () => {
      const legacy =
        '<div style="width: 100%; max-width: 600px;">' +
        `<div style="${COLUMN}"><div>a</div></div><div style="${COLUMN}"><div>b</div></div></div>`;
      const doc = parse(legacy, 'preserve');
      const columns = first(doc, 'columns');
      expect(columns).toBeTruthy();
      // Recognised exactly, not kept as authored markup beside the node.
      expect(columns.attrs['html'] ?? null).toBeNull();
      const out = serializeToHTML(doc, schema);
      expect(out).toContain(
        '<div class="aee-layout-columns" style="width: 100%; max-width: 600px;">',
      );
      expect(out.match(/class="aee-layout-column"/g)).toHaveLength(2);
    });

    it('a client’s renamed marker is no difference either: the block is exactly ours', () => {
      const ours = editorOutputs()[0];
      const renamed = ours.replace('class="aee-layout-section"', 'class="x_aee-layout-section"');
      const section = first(parse(renamed, 'preserve'), 'section');
      expect(section).toBeTruthy();
      expect(section.attrs['html'] ?? null).toBeNull();
    });
  });

  describe('sending', () => {
    it('a marked stacking column still gets its phone class, beside the marker', () => {
      const column = `<div class="aee-layout-column" style="${COLUMN}"><div>a</div></div>`;
      expect(markStackingColumns(column)).toContain(
        '<div class="aee-layout-column aee-stack" style="display: inline-block;',
      );
      // Unmarked (markup from before the markers): as it always was.
      expect(markStackingColumns(column.replace(' class="aee-layout-column"', ''))).toContain(
        '<div class="aee-stack" style="display: inline-block;',
      );
    });
  });

  describe('writer mode — layout blocks static, content tables never', () => {
    it('a table written without the role (another editor’s) keeps its gestures with layout tables off', () => {
      const editor = createEditor({
        parent: document.createElement('div'),
        extensions: emailExtensions,
        content:
          '<table class="table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>' +
          '<table class="aee-layout-table" role="presentation"><tbody><tr><td>c</td><td>d</td></tr></tbody></table>',
      });
      editor.commands['setLayoutInteraction']({ table: false, columns: false, section: false });
      const tables: Node[] = [];
      editor.state.doc.forEach((node) => {
        if (node.type.name === 'table') tables.push(node);
      });
      expect(tables.map((table) => layoutBlockInteractive(editor.state, table))).toEqual([
        true,
        false,
      ]);
      editor.destroy();
    });
  });
});

/** What the editor writes for each marked block — the identity corpus. */
function editorOutputs(): string[] {
  const editor = createEditor({
    parent: document.createElement('div'),
    extensions: emailExtensions,
  });
  const outputs: string[] = [];
  const write = (run: () => void) => {
    editor.setContent('<div>x</div>');
    run();
    outputs.push(editor.getHTML());
  };
  write(() => editor.commands['insertSection']('#f1f3f4'));
  write(() => editor.commands['insertColumns'](3));
  write(() => editor.commands['insertTable'](2, 3, 'layout'));
  write(() => editor.commands['insertTable'](2, 2, 'bordered'));
  editor.destroy();
  outputs.push(
    canonical(
      '<h3 style="margin: 0">t</h3><ol start="4" style="margin: 0"><li><div>a</div></li></ol>',
    ),
  );
  return outputs;
}
