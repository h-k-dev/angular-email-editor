import { Node } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';

/** The document's blocks, by name — a table as `table(rows×cells)`. */
const outline = (doc: Node): string[] => {
  const blocks: string[] = [];
  doc.forEach((node) => {
    blocks.push(
      node.type.name === 'table'
        ? `table(${node.childCount}×${node.child(0).childCount})`
        : node.type.name,
    );
  });
  return blocks;
};

describe('a block asked for in a table cell', () => {
  let host: HTMLElement;
  let editor: Editor;

  const run = (id: string) => editor.exec(editor.actions.find((action) => action.id === id)!.command);

  /** A paragraph, a 3×3 table of `kind` with words in its first cell and the
      caret after them, a paragraph. */
  const mount = (kind: 'table' | 'layout-table') => {
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>Vor</div><div><br></div><div>Nach</div>',
    });
    // The empty line, swapped for the table; the caret lands in cell (0, 0).
    let empty = 0;
    editor.state.doc.forEach((node, offset, index) => {
      if (index === 1) empty = offset + 1;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, empty)),
    );
    run(kind);
    editor.view.dispatch(editor.state.tr.insertText('Zelle A'));
  };

  const cellText = () => editor.state.doc.child(1).child(0).child(0).textContent;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  for (const kind of ['table', 'layout-table'] as const) {
    describe(kind === 'table' ? 'a table' : 'a layout table', () => {
      beforeEach(() => mount(kind));

      it('starts whole', () => {
        expect(outline(editor.state.doc)).toEqual(['paragraph', 'table(3×3)', 'paragraph']);
        expect(cellText()).toBe('Zelle A');
      });

      // Each used to split the table round the caret: the cell's words in a
      // table of one cell, the block, the rest as a second table.
      for (const [id, block] of [
        ['divider', 'divider'],
        ['spacer', 'spacer'],
        ['section', 'section'],
        ['columns', 'columns'],
        ['3-columns', 'columns'],
        ['table', 'table(3×3)'],
        ['layout-table', 'table(3×3)'],
      ] as const) {
        it(`puts a ${id} under the table, which stays whole`, () => {
          expect(run(id)).toBe(true);
          expect(outline(editor.state.doc)).toEqual(['paragraph', 'table(3×3)', block, 'paragraph']);
          expect(cellText()).toBe('Zelle A');
        });
      }

      it('puts the caret into what holds text — a section, a column, the new table', () => {
        const caretIn = () => {
          const { $from } = editor.state.selection;
          return Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name);
        };
        run('section');
        expect(caretIn().slice(0, 2)).toEqual(['doc', 'section']);
        // …and that section's caret is no cell's: the next block goes where it stands.
        run('columns');
        expect(caretIn()).toContain('column');
      });

      it('is one step: one undo takes the block away again', () => {
        run('divider');
        editor.exec((state, dispatch, view) => editor.commands['undo'](state, dispatch, view));
        expect(outline(editor.state.doc)).toEqual(['paragraph', 'table(3×3)', 'paragraph']);
        expect(cellText()).toBe('Zelle A');
      });

      it('still writes what a cell can hold into the cell', () => {
        run('button');
        expect(outline(editor.state.doc)).toEqual(['paragraph', 'table(3×3)', 'paragraph']);
        expect(editor.state.doc.child(1).child(0).child(0).lastChild?.type.name).toBe('button');
      });
    });
  }

  it('leaves a block asked for on a line of its own where it was: the line is swapped for it', () => {
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>Vor</div><div><br></div><div>Nach</div>',
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    run('divider');
    expect(outline(editor.state.doc)).toEqual(['paragraph', 'divider', 'paragraph']);
  });
});
