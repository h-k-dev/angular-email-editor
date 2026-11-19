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

describe('a block asked for between the words of a line', () => {
  let host: HTMLElement;
  let editor: Editor;

  const run = (id: string) => editor.exec(editor.actions.find((action) => action.id === id)!.command);

  /** One line of `text` between two others, the caret where `|` stands (a
      second `|` ends a selection). */
  const mount = (text: string) => {
    const from = text.indexOf('|');
    const to = text.lastIndexOf('|');
    const words = text.replace(/\|/g, '');
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: `<div>Vor</div><div>${words.replace(/ {2}/g, ' &nbsp;')}</div><div>Nach</div>`,
    });
    let start = 0;
    editor.state.doc.forEach((node, offset, index) => {
      if (index === 1) start = offset + 1;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, start + from, start + (to === from ? from : to - 1)),
      ),
    );
  };

  /** The lines round the block, as text — a space shown as `·`. */
  const lines = () => {
    const out: string[] = [];
    editor.state.doc.forEach((node) =>
      out.push(node.isTextblock ? node.textContent.replace(/[ \u00a0]/g, '·') : `<${node.type.name}>`),
    );
    return out.slice(1, -1);
  };

  /** Saved and opened again, the document says the same HTML. */
  const reopensAsSaved = () => {
    const saved = editor.getHTML();
    editor.setContent(saved);
    return editor.getHTML() === saved;
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  // The second half used to start with the space: shown by no browser, and
  // gone at the next opening.
  for (const id of ['divider', 'spacer', 'section', 'columns', 'table', 'layout-table']) {
    it(`leaves no space at the cut of a ${id}`, () => {
      mount('Hallo Welt| hier');
      run(id);
      const [first, , last] = [lines()[0], lines()[1], lines().at(-1)];
      expect(first).toBe('Hallo·Welt');
      expect(last).toBe('hier');
      expect(reopensAsSaved()).toBe(true);
    });
  }

  it('takes the space before the caret as well as the one after it', () => {
    mount('Hallo Welt |hier');
    run('divider');
    expect(lines()).toEqual(['Hallo·Welt', '<divider>', 'hier']);

    editor.destroy();
    mount('Hallo Welt | hier');
    run('divider');
    expect(lines()).toEqual(['Hallo·Welt', '<divider>', 'hier']);
  });

  it('takes one space a side, no more: what was typed twice is the writer’s', () => {
    mount('Hallo  |  hier');
    run('divider');
    expect(lines()).toEqual(['Hallo·', '<divider>', '·hier']);
  });

  it('leaves no space at the end of a line the block goes under', () => {
    mount('Hallo Welt |');
    run('divider');
    expect(lines()).toEqual(['Hallo·Welt', '<divider>']);
    expect(reopensAsSaved()).toBe(true);
  });

  it('leaves no space at the start of a line the block goes over', () => {
    mount('| Hallo Welt');
    run('divider');
    expect(lines().filter((line) => line !== '')).toEqual(['<divider>', 'Hallo·Welt']);
  });

  it('cuts round a selection the same way', () => {
    mount('Hallo |Welt| hier');
    run('divider');
    expect(lines()).toEqual(['Hallo', '<divider>', 'hier']);
  });

  it('touches no letter where there is no space at the cut', () => {
    mount('Hal|lo');
    run('divider');
    expect(lines()).toEqual(['Hal', '<divider>', 'lo']);
  });

  it('is one step: one undo brings the line back, spaces and all', () => {
    mount('Hallo Welt| hier');
    run('divider');
    editor.exec((state, dispatch, view) => editor.commands['undo'](state, dispatch, view));
    expect(lines()).toEqual(['Hallo·Welt·hier']);
  });

  it('puts the caret into a section cut in between', () => {
    mount('Hallo Welt| hier');
    run('section');
    expect(editor.state.selection.$from.node(1).type.name).toBe('section');
  });
});

describe('a divider or a spacer asked for inside a container', () => {
  let host: HTMLElement;
  let editor: Editor;

  const run = (id: string) => editor.exec(editor.actions.find((action) => action.id === id)!.command);

  /** `content`, the caret at the end of the text `after`. */
  const mount = (content: string, after: string) => {
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text!.includes(after)) {
        at = pos + node.text!.indexOf(after) + after.length;
      }
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  };

  /** What the caret stands in, outermost first. */
  const caretIn = () => {
    const { $from } = editor.state.selection;
    return Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type.name);
  };
  /** The blocks of the container the caret stands in. */
  const siblings = () => {
    const { $from } = editor.state.selection;
    const container = $from.node($from.depth - 1);
    return Array.from({ length: container.childCount }, (_, index) => container.child(index).type.name);
  };
  const outside = () => editor.state.doc.lastChild!.textContent;

  const LIST =
    '<div>Vor</div><ul class="aee-layout-list" style="margin: 0px; padding-left: 24px;">' +
    '<li><div>Punkt eins</div></li></ul><div>Nach</div>';

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  for (const id of ['divider', 'spacer']) {
    // The caret used to land on the line after the list.
    it(`keeps the caret in the list item, on a new line under the ${id}`, () => {
      mount(LIST, 'Punkt eins');
      run(id);
      expect(caretIn()).toEqual(['doc', 'bulletList', 'listItem', 'paragraph']);
      expect(siblings()).toEqual(['paragraph', id, 'paragraph']);
      expect(editor.state.selection.$from.parent.textContent).toBe('');
      // The line after the list is as it was.
      expect(outside()).toBe('Nach');
    });

    it(`keeps the caret in a section, under the ${id}`, () => {
      mount('<div>Vor</div><div>Mitte</div><div>Nach</div>', 'Mitte');
      run('section');
      editor.view.dispatch(editor.state.tr.insertText('Im Band'));
      run(id);
      expect(caretIn().slice(0, 2)).toEqual(['doc', 'section']);
      expect(siblings()).toEqual(['paragraph', id, 'paragraph']);
    });

    it(`keeps the caret in a column, under the ${id}`, () => {
      mount('<div>Vor</div><div><br></div><div>Nach</div>', 'Vor');
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
      );
      run('columns');
      run(id);
      expect(caretIn()).toContain('column');
      expect(siblings()[0]).toBe(id);
    });
  }

  it('takes the line that already follows it in the container — no new one', () => {
    mount(
      '<div>Vor</div><ul class="aee-layout-list" style="margin: 0px; padding-left: 24px;">' +
        '<li><div>Punkt eins</div><div>darunter</div></li></ul><div>Nach</div>',
      'Punkt eins',
    );
    run('divider');
    expect(siblings()).toEqual(['paragraph', 'divider', 'paragraph']);
    expect(editor.state.selection.$from.parent.textContent).toBe('darunter');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
  });

  it('writes on under the divider: what is typed next is the list item’s', () => {
    mount(LIST, 'Punkt eins');
    run('divider');
    editor.view.dispatch(editor.state.tr.insertText('weiter'));
    const item = editor.state.doc.child(1).child(0);
    expect(item.lastChild!.textContent).toBe('weiter');
    expect(outside()).toBe('Nach');
  });

  it('is one step: one undo takes the divider and its line away', () => {
    mount(LIST, 'Punkt eins');
    const before = editor.state.doc;
    run('divider');
    editor.exec((state, dispatch, view) => editor.commands['undo'](state, dispatch, view));
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('leaves a line of the page as before: the caret on the line under the divider', () => {
    mount('<div>Vor</div><div>Mitte</div><div>Nach</div>', 'Mitte');
    run('divider');
    expect(caretIn()).toEqual(['doc', 'paragraph']);
    expect(editor.state.selection.$from.parent.textContent).toBe('Nach');
    expect(editor.state.doc.childCount).toBe(4);
  });

  it('leaves the caret in the cell for a divider put under a table', () => {
    mount('<div>Vor</div><div><br></div><div>Nach</div>', 'Vor');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    run('table');
    run('divider');
    expect(caretIn()).toContain('tableCell');
  });
});
