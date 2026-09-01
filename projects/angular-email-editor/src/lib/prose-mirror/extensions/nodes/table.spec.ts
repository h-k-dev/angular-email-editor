import { TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailExtensions } from '../kits';
import { TABLE_BORDER_COLOR, Table, findTableContext } from './table';

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
      '<table style="width: 100%; table-layout: fixed; border-collapse: collapse;" role="presentation">',
    );
    expect(html).toContain('<tbody>');
    // Borderless: grid lines are editor-only, never in the email itself.
    expect(html).toContain('<td style="vertical-align: top; overflow-wrap: break-word;">a</td>');
    expect(html).not.toContain('border:');
  });

  it('round-trips a table with empty cells without growing phantom cells', () => {
    const empty =
      '<table><tbody><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table>';
    const once = canonical(empty);
    expect((once.match(/<td/g) || []).length).toBe(4);
    expect(canonical(once)).toBe(once);
  });

  it('keeps line breaks inside cells as a fixpoint — no phantom cells', () => {
    const withBreaks =
      '<table><tbody><tr><td>a<br>b</td><td><br></td></tr></tbody></table>';
    const once = canonical(withBreaks);
    expect(once).toContain('a<br>b');
    expect((once.match(/<td/g) || []).length).toBe(2);
    expect(canonical(once)).toBe(once);
  });

  it('keeps colspan and rowspan — both render in Outlook — as a fixpoint', () => {
    const merged =
      '<table><tbody><tr><td colspan="2">wide</td></tr>' +
      '<tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>';
    const once = canonical(merged);
    expect(once).toContain('<td colspan="2" style="vertical-align: top; overflow-wrap: break-word;">wide');
    expect(once).toContain('<td rowspan="2" style="vertical-align: top; overflow-wrap: break-word;">tall');
    expect(canonical(once)).toBe(once);
  });

  it('repairs a ragged table on parse — short rows are padded to the grid', () => {
    // Real mail is full of these; before prosemirror-tables the ragged shape
    // survived and every index-addressed edit then targeted the wrong cell.
    const ragged = '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>';
    const once = canonical(ragged);
    expect((once.match(/<td/g) || []).length).toBe(4);
    expect(canonical(once)).toBe(once);
  });

  it('trims a rowspan that reaches past the last row', () => {
    // A colspan simply defines the grid's width, but a rowspan can point at
    // rows that do not exist — `fixTables` clips it back to the table.
    const overlong = '<table><tbody><tr><td rowspan="5">a</td><td>b</td></tr></tbody></table>';
    const once = canonical(overlong);
    expect(once).not.toContain('rowspan');
    expect(canonical(once)).toBe(once);
  });

  it('parses a th as an ordinary cell — an email table is presentational', () => {
    const withHeader =
      '<table><tbody><tr><th>h</th><th>i</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>';
    const once = canonical(withHeader);
    expect(once).not.toContain('<th');
    expect((once.match(/<td/g) || []).length).toBe(4);
  });

  it('never emits colwidth or pixel widths — percentages are the only width', () => {
    expect(canonical(SAMPLE)).not.toContain('colwidth');
    expect(canonical('<table><tbody><tr><td width="120">a</td></tr></tbody></table>')).not.toContain(
      'width="120"',
    );
  });

  it('keeps authored cell padding — px only — and drops the rest', () => {
    // Padding in the email is the author's choice; the editor's comfortable
    // default is CSS-only and never serializes.
    const padded = canonical('<table><tbody><tr><td style="padding: 4px 10px;">a</td></tr></tbody></table>');
    expect(padded).toContain('<td style="padding: 4px 10px; vertical-align: top;');
    expect(canonical(padded)).toBe(padded);

    // Non-px padding is the responsiveness trap and repairs away.
    const pct = canonical('<table><tbody><tr><td style="padding: 5%;">a</td></tr></tbody></table>');
    expect(pct).not.toContain('padding');
  });

  it('keeps an authored cell border, normalized to 1px solid', () => {
    const bordered = canonical(
      '<table><tbody><tr><td style="border: 2px dashed rgb(1, 2, 3);">a</td></tr></tbody></table>',
    );
    expect(bordered).toContain('border: 1px solid rgb(1, 2, 3);');
    expect(canonical(bordered)).toBe(bordered);
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

  it('setCellBackground fills only the current cell with a canonical rgb() bg', () => {
    editor.commands['insertTable'](); // cursor is in cell (0,0)
    editor.commands['setCellBackground']('#e6f4ea');
    const html = editor.getHTML();
    expect(html).toContain(
      '<td style="vertical-align: top; overflow-wrap: break-word; background-color: rgb(230, 244, 234); color: rgb(32, 33, 36);">',
    );
    // Only one cell filled; still a fixpoint and lint-clean.
    expect((html.match(/background-color/g) || []).length).toBe(1);
    expect(canonical(html)).toBe(html);
    expect(lintHTML(html)).toEqual([]);
    editor.commands['setCellBackground'](null);
    expect(editor.getHTML()).not.toContain('background-color');
  });

  it('parses a legacy bgcolor attribute into the cell fill', () => {
    const html = canonical('<table><tbody><tr><td bgcolor="#e6f4ea">x</td></tr></tbody></table>');
    expect(html).toContain('background-color: rgb(230, 244, 234)');
  });

  it('refuses to delete the last row or column', () => {
    editor.commands['insertTable'](1, 1);
    expect(dims()).toEqual({ rows: 1, cols: 1 });
    expect(editor.commands['deleteRow']()).toBe(false);
    expect(editor.commands['deleteColumn']()).toBe(false);
    expect(dims()).toEqual({ rows: 1, cols: 1 });
  });

  it('/bordered-table inserts the Excel grid, and new cells inherit it', () => {
    const item = Table.slashItems!({ schema: editor.schema, extensions: [] }).find(
      (entry) => entry.title === 'Bordered table',
    )!;
    editor.exec(item.command);
    let html = editor.getHTML();
    expect((html.match(/border: 1px solid rgb\(208, 215, 229\);/g) || []).length).toBe(4);
    expect(canonical(html)).toBe(html);
    expect(lintHTML(html)).toEqual([]);

    // Structural edits create default (borderless) cells; the repair pass
    // keeps a uniformly bordered table uniform.
    editor.commands['addRowAfter']();
    editor.commands['addColumnAfter']();
    html = editor.getHTML();
    expect(dims()).toEqual({ rows: 3, cols: 3 });
    expect((html.match(/border: 1px solid rgb\(208, 215, 229\);/g) || []).length).toBe(9);
    expect(html).toContain(TABLE_BORDER_COLOR);
  });

  it('a table with mixed border colours is left as written', () => {
    editor.setContent(
      '<table><tbody><tr>' +
        '<td style="border: 1px solid rgb(1, 2, 3);">a</td>' +
        '<td style="border: 1px solid rgb(9, 9, 9);">b</td>' +
        '</tr></tbody></table>',
    );
    const html = editor.getHTML();
    expect(html).toContain('rgb(1, 2, 3)');
    expect(html).toContain('rgb(9, 9, 9)');
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

  it('Enter in a cell inserts a line break — never splits the row', () => {
    editor.commands['insertTable'](1, 3); // cursor in cell (0,0)
    const key = (name: string, init?: KeyboardEventInit) =>
      editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: name, ...init })),
      );

    // Empty first cell: previously a silent no-op.
    expect(key('Enter')).toBe(true);
    expect(dims()).toEqual({ rows: 1, cols: 3 });

    // Empty *in-between* cell: previously `liftEmptyBlock` split the row here
    // and Enter grew the table.
    key('Tab');
    expect(key('Enter')).toBe(true);
    expect(dims()).toEqual({ rows: 1, cols: 3 });

    // Shift-Enter breaks too (the generic hard-break refuses isolating cells).
    expect(key('Enter', { shiftKey: true })).toBe(true);
    expect(dims()).toEqual({ rows: 1, cols: 3 });

    // Mid-text: the break lands where the cursor is.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('ab'));
      return true;
    });
    editor.exec((state, dispatch) => {
      const pos = state.selection.from - 1; // between a and b
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
      return true;
    });
    expect(key('Enter')).toBe(true);
    expect(editor.getHTML()).toContain('a<br>b');
    expect(dims()).toEqual({ rows: 1, cols: 3 });
  });

  it('Mod-A inside a cell selects only that cell — content or blank', () => {
    editor.commands['insertTable'](1, 2); // cursor in cell (0,0)
    const key = (name: string, init?: KeyboardEventInit) =>
      editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: name, ...init })),
      );

    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('hello'));
      return true;
    });
    expect(key('a', { ctrlKey: true })).toBe(true);
    let sel = editor.state.selection;
    expect(sel.$from.parent.type.name).toBe('tableCell');
    expect(editor.state.doc.textBetween(sel.from, sel.to)).toBe('hello');

    // A blank cell has no text to scope to: Mod-A selects every cell instead
    // (the grid-wide selection whose Delete removes the table).
    key('Tab');
    expect(key('a', { ctrlKey: true })).toBe(true);
    sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    let covered = 0;
    (sel as CellSelection).forEachCell(() => covered++);
    expect(covered).toBe(2);
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

  /** Every `tableCell` position in document order. */
  const cellPositions = () => {
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') positions.push(pos);
      return true;
    });
    return positions;
  };

  /** Selects a rectangle of cells, the way a shift-drag does. */
  const selectCells = (anchor: number, head: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, anchor, head)));
      return true;
    });

  it('merges a cell selection into one cell and splits it back', () => {
    editor.commands['insertTable']();
    const [first, second] = cellPositions();
    selectCells(first, second);

    editor.commands['mergeCells']();
    expect(editor.getHTML()).toContain('colspan="2"');
    // The grid is still 2x2 — a merged cell spans it, it does not shrink it.
    expect(dims()).toEqual({ rows: 2, cols: 2 });

    editor.commands['splitCell']();
    expect(editor.getHTML()).not.toContain('colspan');
    expect(editor.getHTML()).toBe(editor.getHTML().trim());
  });

  it('setCellBackground fills every cell of a cell selection', () => {
    editor.commands['insertTable']();
    const [first, second] = cellPositions();
    selectCells(first, second);
    editor.commands['setCellBackground']('#e6f4ea');
    const fills = editor.getHTML().match(/background-color: rgb\(230, 244, 234\)/g) || [];
    expect(fills.length).toBe(2);
  });

  it('Backspace over a full-grid cell selection removes the table itself', () => {
    editor.commands['insertTable'](2, 2);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[cells.length - 1])),
      );
      return true;
    });
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }),
    );
    expect(findTableContext(editor.state)).toBeNull();
    expect(editor.getHTML()).not.toContain('<table');
  });

  it('Backspace over a full-width row selection removes those rows', () => {
    editor.commands['insertTable'](3, 2);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    // Rows 0-1 (cells 0..3): full width, not full height.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[3])));
      return true;
    });
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }),
    );
    const ctx = findTableContext(editor.state);
    expect(ctx).not.toBeNull();
    expect(ctx!.rows).toBe(1);
    expect(ctx!.cols).toBe(2);
  });

  it('Delete over a full-height column selection removes that column', () => {
    editor.commands['insertTable'](2, 3);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    // Column 0: cells (0,0) and (1,0) — full height, not full width.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[3])));
      return true;
    });
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', keyCode: 46, which: 46, bubbles: true, cancelable: true }),
    );
    const ctx = findTableContext(editor.state);
    expect(ctx).not.toBeNull();
    expect(ctx!.rows).toBe(2);
    expect(ctx!.cols).toBe(2);
  });

  it('Backspace over a partial cell selection clears content, keeps the table', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('hello'));
      return true;
    });
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    // The first row only — the library's deleteCellSelection territory.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[1])));
      return true;
    });
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }),
    );
    expect(editor.getHTML()).toContain('<table');
    expect(editor.getHTML()).not.toContain('hello');
  });

  const key = (k: string, code: number, shift = false) =>
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: k,
        keyCode: code,
        which: code,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  const at = () => {
    const ctx = findTableContext(editor.state);
    return ctx ? [ctx.rowIndex, ctx.colIndex] : null;
  };

  it('arrows move cell to cell from a cell edge, wrapping rows', () => {
    editor.commands['insertTable'](2, 2); // caret in (0,0)
    key('ArrowRight', 39);
    expect(at()).toEqual([0, 1]);
    key('ArrowRight', 39); // end of the row wraps to the next
    expect(at()).toEqual([1, 0]);
    key('ArrowLeft', 37);
    expect(at()).toEqual([0, 1]);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  });

  it('ArrowRight out of the last cell leaves the table', () => {
    editor.setContent(
      '<div>a</div><table><tbody><tr><td></td><td></td></tr></tbody></table><div>after</div>',
    );
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cells[1] + 1)));
      return true;
    });
    key('ArrowRight', 39);
    expect(findTableContext(editor.state)).toBeNull();
    expect(editor.state.selection.$from.parent.textContent).toBe('after');
  });

  it('Shift-arrows at a cell edge grow a cell selection, one cell at a time', () => {
    editor.commands['insertTable'](2, 2);
    key('ArrowRight', 39, true);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    let count = 0;
    (editor.state.selection as CellSelection).forEachCell(() => count++);
    expect(count).toBe(2);

    key('ArrowDown', 40, true); // from a cell selection: no edge check needed
    count = 0;
    (editor.state.selection as CellSelection).forEachCell(() => count++);
    expect(count).toBe(4);

    // A plain arrow collapses the cell selection back to a caret.
    key('ArrowRight', 39);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  });

  it('deleteTable removes the whole node', () => {
    editor.commands['insertTable']();
    editor.commands['deleteTable']();
    expect(findTableContext(editor.state)).toBeNull();
    expect(editor.getHTML()).not.toContain('<table');
  });
});

