import { CellSelection } from 'prosemirror-tables';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { setColumnBoundary, setTableBox } from './column-resize';
import { TableHandleTarget, createTableHandles } from './table-handles';

describe('table handles', () => {
  let host: HTMLElement;
  let editor: Editor;
  let opened: TableHandleTarget | null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    opened = null;
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createTableHandles({
          onOpen: (target) => (opened = target),
          label: (kind, number) => `${kind === 'row' ? 'Row' : 'Column'} ${number} options`,
        }),
      ],
      content:
        '<table><tbody><tr><td>a1</td><td>a2</td><td>a3</td></tr>' +
        '<tr><td>b1</td><td>b2</td><td>b3</td></tr></tbody></table>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const grips = (kind: 'row' | 'column') => [
    ...host.querySelectorAll<HTMLElement>(`.aee-grip--${kind}`),
  ];

  it('hangs one grip on every row and every column', () => {
    expect(grips('row')).toHaveLength(2);
    expect(grips('column')).toHaveLength(3);
    expect(grips('row').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Row 1 options',
      'Row 2 options',
    ]);
    // In the band's first cell, which is what gives the grip its length —
    // no measurement anywhere.
    expect(grips('row')[1].closest('td')!.textContent).toBe('b1');
    expect(grips('column')[2].closest('td')!.textContent).toBe('a3');
  });

  it('selects the whole band on a press, and says which one it was', () => {
    grips('row')[1].click();

    const selection = editor.state.selection as CellSelection;
    const cells: string[] = [];
    selection.forEachCell((cell) => cells.push(cell.textContent));
    expect(cells).toEqual(['b1', 'b2', 'b3']);
    expect(opened).toMatchObject({ kind: 'row', index: 1 });

    grips('column')[0].click();
    const column: string[] = [];
    (editor.state.selection as CellSelection).forEachCell((cell) => column.push(cell.textContent));
    expect(column).toEqual(['a1', 'b1']);
    expect(opened).toMatchObject({ kind: 'column', index: 0 });
  });

  it('keeps the same grip elements while typing, so the pointer is never rebuilt out from under itself', () => {
    const row = grips('row')[0];
    const column = grips('column')[1];
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('x'));
      return true;
    });
    expect(grips('row')[0]).toBe(row);
    expect(grips('column')[1]).toBe(column);
    expect(grips('row')).toHaveLength(2);
    expect(grips('column')).toHaveLength(3);
  });

  it('a grip still selects its table after an edit above it', () => {
    editor.setContent(
      '<div>intro</div>' +
        '<table><tbody><tr><td>a1</td><td>a2</td></tr>' +
        '<tr><td>b1</td><td>b2</td></tr></tbody></table>',
    );
    const grip = grips('row')[1];
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('Hi ', 1));
      return true;
    });
    expect(grips('row')[1]).toBe(grip);
    grip.click();
    const cells: string[] = [];
    (editor.state.selection as CellSelection).forEachCell((cell) => cells.push(cell.textContent));
    expect(cells).toEqual(['b1', 'b2']);
  });

  it('marks the pressed grip expanded without remounting it', () => {
    const grip = grips('row')[1];
    grip.click();
    expect(grip.getAttribute('aria-expanded')).toBe('true');
    expect(grips('row')[1]).toBe(grip);
  });

  it('keeps column grips after a right-edge resize rewrites every cell width', () => {
    // The drag commits `setNodeMarkup` on every cell (absorb into the last
    // column). Mapping would drop the `data-col` decorations those grips
    // light up from — they have to come back, or hovering a cell shows nothing.
    let tablePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (tablePos < 0 && node.type.name === 'table') tablePos = pos;
      return tablePos < 0;
    });
    expect(editor.exec(setTableBox(tablePos, 0, 70, 'last'))).toBe(true);
    expect(grips('column')).toHaveLength(3);
    expect(grips('row')).toHaveLength(2);
    expect([...host.querySelectorAll('td')].every((td) => td.hasAttribute('data-col'))).toBe(true);

    expect(editor.exec(setColumnBoundary(tablePos, 1, 20))).toBe(true);
    expect(grips('column')).toHaveLength(3);
    expect([...host.querySelectorAll('td')].every((td) => td.hasAttribute('data-col'))).toBe(true);
  });

  it('rebuilds grips when the grid itself changes', () => {
    editor.commands['addRowAfter']();
    expect(grips('row')).toHaveLength(3);
  });

  it('keeps grips in step when a move rewrites the table in one replacement', () => {
    // `moveRow`/`duplicateRow` replace the table's whole content in a single
    // step — every position inside the old range is gone, so the cheap
    // mapping path has nothing left to map. The grips (and the `data-col`
    // marks they light up from) have to be rebuilt around the new order.
    grips('row')[0].click();
    expect(editor.commands['moveRow'](1)).toBe(true);

    expect(grips('row')).toHaveLength(2);
    expect(grips('row').map((g) => g.dataset['index'])).toEqual(['0', '1']);
    expect(grips('column')).toHaveLength(3);
    expect([...host.querySelectorAll('td')].every((td) => td.hasAttribute('data-col'))).toBe(true);
    // The row that moved is the one the grips now describe: pressing the
    // second grip selects what is now the second row.
    grips('row')[1].click();
    const cells: string[] = [];
    (editor.state.selection as CellSelection).forEachCell((cell) => cells.push(cell.textContent));
    expect(cells).toEqual(['a1', 'a2', 'a3']);
  });

  it('a row grip does not light the column it happens to live in', () => {
    const wrap = host.querySelector<HTMLElement>('.aee-table-wrap')!;
    host.querySelector('td')!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(wrap.dataset['hoverCol']).toBe('0');

    grips('row')[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    expect(wrap.dataset['hoverCol']).toBeUndefined();
  });

  it('gives a band covered by a merge no grip of its own to lie with', () => {
    // The second row's first cell is the first row's, reaching down: the row
    // still has a grip (its own second cell starts there), the *column* of
    // the merge has one only at its top.
    editor.setContent(
      '<table><tbody><tr><td rowspan="2">tall</td><td>a2</td></tr>' +
        '<tr><td>b2</td></tr></tbody></table>',
    );
    expect(grips('row')).toHaveLength(2);
    expect(grips('row')[1].closest('td')!.textContent).toBe('b2');
    expect(grips('column')).toHaveLength(2);
    expect(grips('column')[0].closest('td')!.textContent).toBe('tall');
  });
});
