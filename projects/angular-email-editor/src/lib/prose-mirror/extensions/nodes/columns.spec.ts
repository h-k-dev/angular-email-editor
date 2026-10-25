import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailExtensions } from '../kits';
import { appendColumn, findColumnsContext, removeLastColumn } from './columns';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const COL = (max: number) =>
  `display: inline-block; width: 100%; max-width: ${max}px; vertical-align: top; ` +
  `box-sizing: border-box;`;
const TWO_COLS =
  `<div style="width: 100%; max-width: 600px;">` +
  `<div style="${COL(300)}"><div>a</div></div>` +
  `<div style="${COL(300)}"><div>b</div></div></div>`;

describe('outlookColumns — the hybrid’s Outlook half', () => {
  it('wraps a columns block’s fluid divs in a fixed table inside [if mso] comments, one cell a column, and parses back without them', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({ parent: host, extensions: emailExtensions, content: '<p>x</p>' });
    editor.commands['insertColumns'](2);
    const out = editor.getHTML();
    expect(out).toContain(
      '<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center"><tr><td width="280" valign="top"><![endif]--><div class="aee-layout-column" style="display: inline-block; width: 100%; max-width: 280px;',
    );
    expect(out).toContain(
      '<!--[if mso]></td><td width="280" valign="top"><![endif]--><div class="aee-layout-column" style="display: inline-block;',
    );
    expect(out).toContain('</div><!--[if mso]></td></tr></table><![endif]--></div>');
    // The round trip: the comments go on parse, the block writes them again.
    // (in the editor's own parse — the default `email` mode keeps the
    // authored `<p>` beside the block).
    expect(serializeToHTML(parseHTML(out, editor.schema, { mode: 'email' }), editor.schema)).toBe(
      out,
    );
    editor.destroy();
    host.remove();
  });
});

describe('columns serialization', () => {
  it('is a round-trip fixpoint', () => {
    const once = canonical(TWO_COLS);
    expect(canonical(once)).toBe(once);
  });

  it('emits a fluid container and inline-block columns', () => {
    const html = canonical(TWO_COLS);
    expect(html).toContain('width: 100%; max-width: 600px;'); // container
    expect(html).toContain('display: inline-block');
    expect(html).toContain('max-width: 300px'); // authored cap kept as-is: parsing is repair, not opinion
    expect(html).toContain('box-sizing: border-box');
    expect(html).toContain('<div>a</div>'); // column content, borderless div line
  });

  it('is lint-clean — max-width paired with width:100% is exempt', () => {
    expect(lintHTML(canonical(TWO_COLS))).toEqual([]);
  });

  it('serializes no padding by default; authored padding stays — and warns', () => {
    // The gutter seen while composing is editorial CSS, not the email's.
    // (`cellpadding` on the Outlook table is the table's, not a padding.)
    expect(canonical(TWO_COLS)).not.toMatch(/padding[-:]/);

    // Authored padding (legacy longhand pair included) canonicalizes to one
    // shorthand, round-trips — and the linter tells the truth about it:
    // Outlook's Word engine ignores padding outside table cells.
    const padded = TWO_COLS.replace(
      /box-sizing: border-box;/g,
      'box-sizing: border-box; padding-left: 8px; padding-right: 8px;',
    );
    const once = canonical(padded);
    expect(once).toContain('box-sizing: border-box; padding: 0px 8px;');
    expect(canonical(once)).toBe(once);
    const warnings = lintHTML(once);
    expect(warnings.every((w) => w.severity === 'warning')).toBe(true);
    expect(warnings.some((w) => w.message.includes('padding'))).toBe(true);
  });

  it('keeps an authored left alignment — left carries no declaration', () => {
    // TWO_COLS has no margins: parsing is repair, not opinion, so it stays left.
    const html = canonical(TWO_COLS);
    expect(html).not.toContain('margin-left');
    expect(canonical(html)).toBe(html);
  });

  it('round-trips each alignment as a fixpoint, lint-clean', () => {
    const withMargins = (margins: string) =>
      TWO_COLS.replace('max-width: 600px;', `max-width: 600px; ${margins}`);
    const centred = canonical(withMargins('margin-left: auto; margin-right: auto;'));
    const right = canonical(withMargins('margin-left: auto;'));

    expect(centred).toContain('max-width: 600px; margin-left: auto; margin-right: auto;');
    // Right: only margin-left is auto, so the block is pushed right.
    expect(right).toContain('max-width: 600px; margin-left: auto;');
    expect(right).not.toContain('margin-right: auto');

    for (const html of [centred, right]) {
      expect(canonical(html)).toBe(html);
      expect(lintHTML(html)).toEqual([]);
    }
  });
});

describe('columns editing', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>intro</div>',
    });
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
      );
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  /** Caret to the end of the column's last line — a fresh column is two
      lines tall, and the hops happen at the column's edge. */
  const toColumnEnd = () =>
    editor.exec((state, dispatch) => {
      const { $from } = state.selection;
      let d = $from.depth;
      while (d > 0 && $from.node(d).type.name !== 'column') d--;
      dispatch?.(state.tr.setSelection(Selection.near(state.doc.resolve($from.end(d)), -1)));
      return true;
    });

  it('horizontal arrows at a column edge hop into the neighbouring column', () => {
    editor.commands['insertColumns'](2); // caret in column 0's empty block
    const key = (k: string, code: number) =>
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          keyCode: code,
          which: code,
          bubbles: true,
          cancelable: true,
        }),
      );
    const columnIndex = () => {
      const { $from } = editor.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'columns') return $from.index(d);
      }
      return -1;
    };
    expect(columnIndex()).toBe(0);
    toColumnEnd();
    key('ArrowRight', 39);
    expect(columnIndex()).toBe(1);
    key('ArrowLeft', 37);
    expect(columnIndex()).toBe(0);
    // Past the last column: out of the block, into whatever follows.
    key('ArrowRight', 39);
    toColumnEnd();
    key('ArrowRight', 39);
    expect(findColumnsContext(editor.state)).toBeNull();
  });

  it('Mod-A scopes to the column: its content, or the block when empty', () => {
    editor.commands['insertColumns'](2); // caret in column 0's empty paragraph
    const key = (k: string, code: number, init: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent('keydown', {
        key: k,
        keyCode: code,
        which: code,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      editor.view.dom.dispatchEvent(ev);
      return ev.defaultPrevented;
    };

    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('hello'));
      return true;
    });
    expect(key('a', 65, { ctrlKey: true })).toBe(true);
    const sel = editor.state.selection;
    expect(editor.state.doc.textBetween(sel.from, sel.to)).toBe('hello');
    expect(findColumnsContext(editor.state)).not.toBeNull();

    // An empty column has no text to scope to: Mod-A selects the whole block
    // (the selection whose Delete removes it).
    key('Tab', 9); // into column 1, still empty
    expect(key('a', 65, { ctrlKey: true })).toBe(true);
    const blockSel = editor.state.selection;
    expect(blockSel).toBeInstanceOf(NodeSelection);
    expect((blockSel as NodeSelection).node.type.name).toBe('columns');
  });

  it('Tab walks the columns and never lets focus escape the editor', () => {
    editor.commands['insertColumns'](3);
    const key = (k: string, code: number, shift = false) => {
      const ev = new KeyboardEvent('keydown', {
        key: k,
        keyCode: code,
        which: code,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      });
      editor.view.dom.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const columnIndex = () => {
      const { $from } = editor.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'columns') return $from.index(d);
      }
      return -1;
    };

    expect(columnIndex()).toBe(0);
    expect(key('Tab', 9)).toBe(true);
    expect(columnIndex()).toBe(1);
    key('Tab', 9);
    expect(columnIndex()).toBe(2);
    key('Tab', 9, true);
    expect(columnIndex()).toBe(1);

    // Past the last column Tab leaves the block — but stays claimed, so the
    // browser never moves focus out of the editor.
    key('Tab', 9);
    expect(key('Tab', 9)).toBe(true);
    expect(findColumnsContext(editor.state)).toBeNull();
  });

  it('insertColumns drops the cursor into the first column', () => {
    editor.commands['insertColumns'](2);
    expect(findColumnsContext(editor.state)).not.toBeNull();
    expect(editor.state.selection.$from.node(-1).type.name).toBe('column');
  });

  it('2 columns split the container minus the client padding budget', () => {
    editor.commands['insertColumns'](2);
    expect(editor.getHTML()).toContain('max-width: 280px'); // (600 − 2×20) / 2
  });

  it('3 columns each get a third of the budgeted width', () => {
    editor.commands['insertColumns'](3);
    expect(editor.getHTML()).toContain('max-width: 186px'); // (600 − 2×20) / 3
    // three inline-block columns
    expect((editor.getHTML().match(/display: inline-block/g) || []).length).toBe(3);
  });

  it('centres a newly inserted block — a left-hugging email body reads as broken', () => {
    editor.commands['insertColumns'](2);
    expect(editor.getHTML()).toContain('max-width: 600px; margin-left: auto; margin-right: auto;');
  });

  it('setColumnBackground fills the current column with a canonical rgb() panel', () => {
    editor.commands['insertColumns'](2); // cursor lands in the first column
    editor.commands['setColumnBackground']('#fef7e0');
    const html = editor.getHTML();
    // The first column gains the fill; it round-trips as a fixpoint and lints clean.
    expect(html).toContain('background-color: rgb(254, 247, 224)');
    expect(canonical(html)).toBe(html);
    expect(lintHTML(html)).toEqual([]);
    // Clearing removes it again.
    editor.commands['setColumnBackground'](null);
    expect(editor.getHTML()).not.toContain('background-color');
  });

  it('addColumn inserts after the cursor, re-splits the caps, and lands in the new column', () => {
    editor.commands['insertColumns'](2); // cursor in the first column
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('a'));
      return true;
    });
    editor.commands['addColumn']();
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('b')); // typed straight into the fresh column
      return true;
    });
    const html = editor.getHTML();
    expect((html.match(/display: inline-block/g) || []).length).toBe(3);
    expect(html).toContain('max-width: 186px'); // (600 − 2×20) / 3
    expect(html).not.toContain('max-width: 280px'); // the old 2-way split is gone
    expect(html.indexOf('>a<')).toBeLessThan(html.indexOf('>b<')); // new column sits after the cursor's
    expect(canonical(html)).toBe(html);
    expect(lintHTML(html)).toEqual([]);
  });

  it('addColumn keeps fills, and stops at MAX_COLUMNS', () => {
    editor.commands['insertColumns'](2);
    editor.commands['setColumnBackground']('#fef7e0');
    expect(editor.commands['addColumn']()).toBe(true); // 3
    expect(editor.commands['addColumn']()).toBe(true); // 4
    expect(editor.commands['addColumn']()).toBe(false); // capped
    const html = editor.getHTML();
    expect((html.match(/display: inline-block/g) || []).length).toBe(4);
    expect(html).toContain('max-width: 140px'); // (600 − 2×20) / 4
    expect(html).toContain('background-color: rgb(254, 247, 224)'); // fill survived the rebuilds
  });

  it('removeColumn deletes the cursor’s column and refuses on the last one', () => {
    editor.commands['insertColumns'](3);
    expect(editor.commands['removeColumn']()).toBe(true);
    expect(editor.getHTML()).toContain('max-width: 280px'); // back to the 2-way split
    expect(editor.commands['removeColumn']()).toBe(true);
    expect(editor.getHTML()).toContain('max-width: 560px'); // a single full-budget column
    expect(editor.commands['removeColumn']()).toBe(false); // emptying the block is deleteColumns' job
    expect(findColumnsContext(editor.state)).not.toBeNull();
  });

  it('deleteColumns removes the whole block', () => {
    editor.commands['insertColumns'](2);
    expect(editor.commands['deleteColumns']()).toBe(true);
    expect(findColumnsContext(editor.state)).toBeNull();
    expect(editor.getHTML()).not.toContain('inline-block');
  });

  const blockPos = () => findColumnsContext(editor.state)!.pos;
  const count = () => findColumnsContext(editor.state)!.node.childCount;
  const typeIn = (text: string) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText(text));
      return true;
    });
  const press = (key: string) =>
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key })),
    );

  it('a fresh column starts two lines tall — from /columns and from the + pill', () => {
    editor.commands['insertColumns'](2);
    const lines = () => {
      const block = findColumnsContext(editor.state)!.node;
      return Array.from({ length: block.childCount }, (_, i) => block.child(i).childCount);
    };
    expect(lines()).toEqual([2, 2]);
    // The caret starts on the first column's first line.
    expect(editor.state.selection.$from.index(-1)).toBe(0);
    editor.exec(appendColumn(blockPos()));
    editor.commands['addColumn']();
    expect(lines()).toEqual([2, 2, 2, 2]);
    // The email gets the same two blank lines the editor shows.
    const html = editor.getHTML();
    expect((html.match(/<div><br><\/div>/g) || []).length).toBe(8);
    expect(canonical(html)).toBe(html);
  });

  it('the + pill appends a column at the end and leaves the caret alone', () => {
    editor.commands['insertColumns'](2); // caret in the first column
    typeIn('a');
    const caret = editor.state.selection.from;
    expect(editor.exec(appendColumn(blockPos()))).toBe(true);
    expect(count()).toBe(3);
    expect(editor.state.selection.from).toBe(caret);
    expect(editor.getHTML()).toContain('max-width: 186px'); // re-split three ways
    expect(editor.exec(appendColumn(blockPos()))).toBe(true); // 4
    expect(editor.exec(appendColumn(blockPos()))).toBe(false); // capped at MAX_COLUMNS
  });

  it('the − pill takes the last column away, and refuses on the last one left', () => {
    editor.commands['insertColumns'](3); // caret in the first column
    typeIn('a');
    expect(editor.exec(removeLastColumn(blockPos()))).toBe(true);
    expect(count()).toBe(2);
    expect(editor.getHTML()).toContain('>a<'); // the first column's text stays
    expect(editor.exec(removeLastColumn(blockPos()))).toBe(true);
    expect(editor.exec(removeLastColumn(blockPos()))).toBe(false);
    expect(count()).toBe(1);
  });

  it('Delete over a whole column removes that column', () => {
    editor.commands['insertColumns'](3); // caret in the first column
    typeIn('a');
    press('Tab'); // into the second column
    typeIn('b');
    // Mod-A scopes to the column's content; Delete then takes the column.
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })),
    );
    expect(press('Delete')).toBe(true);
    expect(count()).toBe(2);
    const html = editor.getHTML();
    expect(html).toContain('>a<');
    expect(html).not.toContain('>b<');
  });

  it('Delete over every column removes the block; less only clears text', () => {
    editor.commands['insertColumns'](2);
    typeIn('abc');
    // Part of a column: an ordinary delete — the text goes, the block stays.
    editor.exec((state, dispatch) => {
      const at = state.selection.from;
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, at - 2, at)));
      return true;
    });
    press('Delete');
    expect(count()).toBe(2);
    expect(editor.getHTML()).toContain('>a<');
    expect(editor.getHTML()).not.toContain('abc');

    press('Tab');
    typeIn('d');
    // From the first column's text start to the last column's text end.
    editor.exec((state, dispatch) => {
      const { pos, node } = findColumnsContext(state)!;
      dispatch?.(
        state.tr.setSelection(TextSelection.create(state.doc, pos + 3, pos + node.nodeSize - 3)),
      );
      return true;
    });
    expect(press('Delete')).toBe(true);
    expect(findColumnsContext(editor.state)).toBeNull();
    expect(editor.getHTML()).not.toContain('inline-block');
  });

  it('ArrowDown from the last column block escapes to a paragraph below', () => {
    editor.commands['insertColumns'](2); // columns is now the last block
    toColumnEnd();
    const escaped = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    );
    expect(escaped).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('under'));
      return true;
    });
    expect(editor.getHTML()).toContain('</div><div>under</div>');
  });
});
