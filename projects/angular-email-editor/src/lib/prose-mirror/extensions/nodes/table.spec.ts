import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailExtensions } from '../kits';
import { findTableContext } from './table';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('table serialization', () => {
  const SAMPLE =
    '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>';

  it('is a round-trip fixpoint (tbody, styles, structure all stable)', () => {
    const once = canonical(SAMPLE);
    expect(canonical(once)).toBe(once);
  });

  it('serializes a borderless presentation table with a tbody', () => {
    const html = canonical(SAMPLE);
    expect(html).toContain(
      '<table style="width: 100%; border-collapse: collapse;" role="presentation">',
    );
    expect(html).toContain('<tbody>');
    // Borderless: grid lines are editor-only, never in the email itself.
    expect(html).toContain('<td style="padding: 8px 12px; vertical-align: top;">a</td>');
    expect(html).not.toContain('border:');
  });

  it('round-trips a table with empty cells without growing phantom cells', () => {
    const empty =
      '<table><tbody><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table>';
    const once = canonical(empty);
    expect((once.match(/<td/g) || []).length).toBe(4);
    expect(canonical(once)).toBe(once);
  });

  it('produces lint-clean output', () => {
    expect(lintHTML(canonical(SAMPLE))).toEqual([]);
  });
});

describe('table editing', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>start</div>',
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

  const dims = () => {
    const ctx = findTableContext(editor.state);
    return ctx ? { rows: ctx.rows, cols: ctx.cols } : null;
  };

  it('inserts a 2x2 table with the cursor inside the first cell', () => {
    editor.commands['insertTable']();
    expect(dims()).toEqual({ rows: 2, cols: 2 });
    expect(editor.state.selection.$from.parent.type.name).toBe('tableCell');
  });

  it('adds and deletes columns and rows', () => {
    editor.commands['insertTable']();
    editor.commands['addColumnAfter']();
    expect(dims()).toEqual({ rows: 2, cols: 3 });
    editor.commands['addRowAfter']();
    expect(dims()).toEqual({ rows: 3, cols: 3 });
    editor.commands['deleteColumn']();
    expect(dims()).toEqual({ rows: 3, cols: 2 });
    editor.commands['deleteRow']();
    expect(dims()).toEqual({ rows: 2, cols: 2 });
  });

  it('refuses to delete the last row or column', () => {
    editor.commands['insertTable'](1, 1);
    expect(dims()).toEqual({ rows: 1, cols: 1 });
    expect(editor.commands['deleteRow']()).toBe(false);
    expect(editor.commands['deleteColumn']()).toBe(false);
    expect(dims()).toEqual({ rows: 1, cols: 1 });
  });

  it('Tab moves across cells and appends a row past the last one', () => {
    editor.commands['insertTable'](1, 2); // 1 row, 2 cols; cursor in cell (0,0)
    const tab = () =>
      editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'Tab' })),
      );

    tab(); // (0,0) -> (0,1)
    expect(dims()).toEqual({ rows: 1, cols: 2 });
    expect(editor.state.selection.$from.index(-1)).toBe(1); // second column

    tab(); // past the end -> new row
    expect(dims()).toEqual({ rows: 2, cols: 2 });
  });

  it('index-addressed commands target a specific row or column', () => {
    editor.commands['insertTable'](2, 2); // cursor in cell (0,0)
    editor.commands['addColumnAt'](0); // prepend a column
    expect(dims()).toEqual({ rows: 2, cols: 3 });
    editor.commands['addRowAt'](2); // append a row
    expect(dims()).toEqual({ rows: 3, cols: 3 });
    editor.commands['deleteColumnAt'](2); // remove a column the cursor is not in
    expect(dims()).toEqual({ rows: 3, cols: 2 });
    editor.commands['deleteRowAt'](0); // remove the first row
    expect(dims()).toEqual({ rows: 2, cols: 2 });
  });

  it('ArrowDown from the last row escapes to a paragraph below a last-block table', () => {
    editor.commands['insertTable'](2, 2); // table is the last (only) block; cursor in cell (0,0)
    const key = (name: string) =>
      editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: name })),
      );
    // Tab to the last cell (0,0)→(0,1)→(1,0)→(1,1), i.e. the last row.
    key('Tab');
    key('Tab');
    key('Tab');
    expect(key('ArrowDown')).toBe(true);
    // A paragraph now follows the table, and the cursor sits in it.
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('below'));
      return true;
    });
    expect(editor.getHTML()).toContain('</table><div>below</div>');
  });

  it('deleteTable removes the whole node', () => {
    editor.commands['insertTable']();
    editor.commands['deleteTable']();
    expect(findTableContext(editor.state)).toBeNull();
    expect(editor.getHTML()).not.toContain('<table');
  });
});
