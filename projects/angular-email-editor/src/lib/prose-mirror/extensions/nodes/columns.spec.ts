import { NodeSelection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailExtensions } from '../kits';
import { findColumnsContext } from './columns';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const COL = (max: number) =>
  `display: inline-block; width: 100%; max-width: ${max}px; vertical-align: top; ` +
  `box-sizing: border-box; padding-left: 8px; padding-right: 8px;`;
const TWO_COLS =
  `<div style="width: 100%; max-width: 600px;">` +
  `<div style="${COL(300)}"><div>a</div></div>` +
  `<div style="${COL(300)}"><div>b</div></div></div>`;

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

  it('keeps an authored left alignment — left carries no declaration', () => {
    // TWO_COLS has no margins: parsing is repair, not opinion, so it stays left.
    const html = canonical(TWO_COLS);
    expect(html).not.toContain('margin-left');
    expect(canonical(html)).toBe(html);
  });

  it('round-trips each alignment as a fixpoint, lint-clean', () => {
    const withMargins = (margins: string) => TWO_COLS.replace('max-width: 600px;', `max-width: 600px; ${margins}`);
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

  it('horizontal arrows at a column edge hop into the neighbouring column', () => {
    editor.commands['insertColumns'](2); // caret in column 0's empty block
    const key = (k: string, code: number) =>
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, keyCode: code, which: code, bubbles: true, cancelable: true }),
      );
    const columnIndex = () => {
      const { $from } = editor.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'columns') return $from.index(d);
      }
      return -1;
    };
    expect(columnIndex()).toBe(0);
    key('ArrowRight', 39);
    expect(columnIndex()).toBe(1);
    key('ArrowLeft', 37);
    expect(columnIndex()).toBe(0);
    // Past the last column: out of the block, into whatever follows.
    key('ArrowRight', 39);
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

  it('ArrowDown from the last column block escapes to a paragraph below', () => {
    editor.commands['insertColumns'](2); // columns is now the last block
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
