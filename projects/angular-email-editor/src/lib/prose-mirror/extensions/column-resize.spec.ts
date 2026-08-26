import { TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { createEditor, Editor } from '../editor';
import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { emailExtensions } from './kits';
import { setColumnBoundary, setTableBox, setTableWidth, columnWidths } from './column-resize';
import { addColumnAtEnd, addRowAtEnd } from './nodes/table';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('column width serialization', () => {
  it('parses a percentage width and round-trips it as a fixpoint', () => {
    const html = canonical(
      '<table><tbody><tr><td style="width: 40%">a</td><td>b</td></tr></tbody></table>',
    );
    expect(html).toContain('width: 40%;');
    expect(canonical(html)).toBe(html);
  });

  it('drops pixel widths on parse — percentages are the only unit', () => {
    const html = canonical(
      '<table><tbody><tr><td style="width: 120px">a</td><td width="200">b</td></tr></tbody></table>',
    );
    expect(html).not.toContain('width: 120');
    expect(html).not.toContain('width: 200');
    expect(html).not.toContain('width="200"');
  });

  it('a span carries the summed width and round-trips stably', () => {
    const once = canonical(
      '<table><tbody><tr><td colspan="2" style="width: 50%">w</td><td>c</td></tr>' +
        '<tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>',
    );
    expect(once).toContain('colspan="2"');
    expect(once).toContain('width: 50%;');
    expect(canonical(once)).toBe(once);
  });
});

describe('column resize', () => {
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

  const tablePos = () => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table' && found === -1) found = pos;
      return found === -1;
    });
    return found;
  };

  const tableNode = () => editor.state.doc.nodeAt(tablePos())!;

  it('renders the editor-only wrapper and a colgroup that tracks the grid', () => {
    editor.commands['insertTable'](2, 3);
    expect(host.querySelector('.aee-table-wrap')).toBeTruthy();
    expect(host.querySelectorAll('colgroup > col').length).toBe(3);

    editor.commands['addColumnAfter']();
    expect(host.querySelectorAll('colgroup > col').length).toBe(4);

    // None of it is in the email — or the clipboard, which uses the same toDOM.
    const html = editor.getHTML();
    expect(html).not.toContain('aee-table-wrap');
    expect(html).not.toContain('colgroup');
  });

  it('setColumnBoundary writes the pair to every cell of both columns', () => {
    editor.commands['insertTable'](2, 2);
    expect(editor.exec(setColumnBoundary(tablePos(), 0, 30))).toBe(true);

    expect(columnWidths(tableNode())).toEqual([30, 70]);
    const html = editor.getHTML();
    expect((html.match(/width: 30%;/g) || []).length).toBe(2);
    expect((html.match(/width: 70%;/g) || []).length).toBe(2);
    // Still canonical: the same HTML round-trips untouched.
    expect(canonical(html)).toBe(html);
  });

  it('the colgroup mirrors a committed resize', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setColumnBoundary(tablePos(), 0, 30));
    const cols = host.querySelectorAll<HTMLElement>('colgroup > col');
    expect(cols[0].style.width).toBe('30%');
    expect(cols[1].style.width).toBe('70%');
  });

  it('clamps so no column drops below the floor', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setColumnBoundary(tablePos(), 0, 2));
    expect(columnWidths(tableNode())).toEqual([10, 90]);
    editor.exec(setColumnBoundary(tablePos(), 0, 98));
    expect(columnWidths(tableNode())).toEqual([90, 10]);
  });

  it('conserves the pair: other columns are untouched by a drag', () => {
    editor.commands['insertTable'](2, 3);
    editor.exec(setColumnBoundary(tablePos(), 1, 20));
    // Column 0 keeps its share; columns 1+2 split their two-thirds anew.
    const widths = columnWidths(tableNode());
    expect(widths[0]).toBeNull(); // never dragged, never materialized
    expect(widths[1]! + widths[2]!).toBeCloseTo(66.6, 0);
  });

  it('adding a column to a resized table frees an equal share for it', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setColumnBoundary(tablePos(), 0, 65.2));
    // Cursor still sits in cell (0,0): the new column lands at index 1.
    editor.commands['addColumnAfter']();
    // Declared widths scale by 2/3; the new column stays undeclared and takes
    // the freed third as leftover — without this it would get 100-100 = zero.
    expect(columnWidths(tableNode())).toEqual([43.5, null, 23.2]);
    const html = editor.getHTML();
    expect(canonical(html)).toBe(html);
  });

  it('the add-column rescale floors at the minimum share', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setColumnBoundary(tablePos(), 0, 98)); // clamps to 90/10
    editor.commands['addColumnAfter']();
    // 10 * 2/3 would starve the thin column; it floors at 10 instead.
    expect(columnWidths(tableNode())).toEqual([60, null, 10]);
  });

  it('a plain table adds columns without materializing any widths', () => {
    editor.commands['insertTable'](2, 2);
    editor.commands['addColumnAfter']();
    expect(columnWidths(tableNode())).toEqual([null, null, null]);
  });

  it('setTableWidth commits a percentage table width, clamped to its range', () => {
    editor.commands['insertTable'](2, 2);
    expect(editor.exec(setTableWidth(tablePos(), 80))).toBe(true);
    const html = editor.getHTML();
    expect(html).toContain('<table style="width: 80%; table-layout: fixed; border-collapse: collapse;"');
    expect(canonical(html)).toBe(html);

    editor.exec(setTableWidth(tablePos(), 5));
    expect(tableNode().attrs['width']).toBe(20);
    editor.exec(setTableWidth(tablePos(), 150));
    expect(tableNode().attrs['width']).toBe(100);
  });

  it('the edge handles and lines layer follow the table box', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setTableWidth(tablePos(), 80));
    const edges = host.querySelectorAll<HTMLElement>('.aee-col-line--edge');
    const lines = host.querySelector<HTMLElement>('.aee-col-lines')!;
    // Left edge on the offset (0), right edge on offset + width.
    expect([...edges].map((edge) => edge.style.left)).toEqual(['0%', '80%']);
    // The layer itself carries no inline geometry: CSS insets it to the
    // wrapper's content box (inside the editor-only gutter), so every child
    // percentage above is already a share of the table's own area.
    expect(lines.style.left).toBe('');
    expect(lines.style.width).toBe('');
    expect(editor.getHTML()).not.toContain('aee-col-line--edge');
  });

  it('an edge resize absorbs into the adjacent column — interior boundaries hold', () => {
    editor.commands['insertTable'](2, 2);
    // Right edge in to 70%: the last column absorbs; column 0 keeps its
    // absolute size (50% of 100 = 71.4% of 70).
    editor.exec(setTableBox(tablePos(), 0, 70, 'last'));
    expect(tableNode().attrs['width']).toBe(70);
    expect(columnWidths(tableNode())).toEqual([71.4, 28.6]);

    // Left edge in to 20% (right edge pinned at 70, as a real left-edge drag
    // pins it): the first column absorbs, and the interior boundary stays at
    // 50% of the *container* — where it has been since the first resize.
    editor.exec(setTableBox(tablePos(), 20, 50, 'first'));
    const widths = columnWidths(tableNode())!;
    const boundary = 20 + (widths[0]! * 50) / 100;
    expect(Math.round(boundary)).toBe(50);
  });

  it('an edge resize floors where the absorbing column would starve', () => {
    editor.commands['insertTable'](2, 2);
    // Asking for 40% would leave the last column under the 10% floor:
    // width clamps to 50/0.9 = 55.6 instead.
    editor.exec(setTableBox(tablePos(), 0, 40, 'last'));
    expect(tableNode().attrs['width']).toBe(55.6);
    // 10.1, not 10.0 — the non-absorbing column rounds first (89.9) and the
    // absorbing one takes the exact remainder.
    expect(columnWidths(tableNode())![1]).toBeCloseTo(10, 0);
  });

  it('offset serializes as margin-left and round-trips', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setTableBox(tablePos(), 15, 70));
    const html = editor.getHTML();
    expect(html).toContain(
      '<table style="width: 70%; margin-left: 15%; table-layout: fixed; border-collapse: collapse;"',
    );
    expect(canonical(html)).toBe(html);
    // Both edge handles track the model: left at the offset, right at its end.
    const edges = host.querySelectorAll<HTMLElement>('.aee-col-line--edge');
    expect([...edges].map((edge) => edge.style.left).sort()).toEqual(['15%', '85%']);
  });

  it('a pixel table width parses to full fluid width — repair, not respect', () => {
    const html = canonical('<table style="width: 600px"><tbody><tr><td>a</td></tr></tbody></table>');
    expect(html).toContain('width: 100%; table-layout: fixed');
    expect(canonical(html)).toBe(html);
  });

  it('a percentage table width round-trips as a fixpoint', () => {
    const html = canonical('<table style="width: 70%"><tbody><tr><td>a</td></tr></tbody></table>');
    expect(html).toContain('<table style="width: 70%; table-layout: fixed; border-collapse: collapse;"');
    expect(canonical(html)).toBe(html);
  });

  it('the add pills append at the end, rescaling widths for the column', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setColumnBoundary(tablePos(), 0, 65.2));

    // Clicking the column pill appends at the end; declared widths scale by
    // 2/3 and the new last column takes the freed third as leftover.
    host.querySelector<HTMLElement>('.aee-add-pill--column')!.click();
    expect(columnWidths(tableNode())).toEqual([43.5, 23.2, null]);

    host.querySelector<HTMLElement>('.aee-add-pill--row')!.click();
    expect(tableNode().childCount).toBe(3);
    // Rows carry no width math; the columns are untouched.
    expect(columnWidths(tableNode())).toEqual([43.5, 23.2, null]);
  });

  it('the pills track the table box and never serialize', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setTableBox(tablePos(), 10, 60));
    const zone = host.querySelector<HTMLElement>('.aee-add-zone')!;
    const column = host.querySelector<HTMLElement>('.aee-add-pill--column')!;
    const row = host.querySelector<HTMLElement>('.aee-add-pill--row')!;
    // The sensor zone starts on the table's right edge (10 + 60); the pill
    // lives inside it. The row pill is wrapper-latched: no inline position.
    expect(zone.style.left).toBe('70%');
    expect(zone.contains(column)).toBe(true);
    expect(row.style.left).toBe('');
    const html = editor.getHTML();
    expect(html).not.toContain('aee-add-pill');
    expect(html).not.toContain('aee-add-zone');
  });

  it('addColumnAtEnd and addRowAtEnd are position-addressed and validated', () => {
    editor.commands['insertTable'](2, 2);
    expect(editor.exec(addColumnAtEnd(0))).toBe(false); // not a table position
    expect(editor.exec(addRowAtEnd(tablePos()))).toBe(true);
    expect(tableNode().childCount).toBe(3);
  });

  it('marks the wrapper for the caret\'s grid edges — last column and last row', () => {
    editor.commands['insertTable'](2, 2);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    const caretInto = (cellPos: number) =>
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cellPos + 1)));
        return true;
      });
    const classes = () => {
      const list = host.querySelector('.aee-table-wrap')!.classList;
      return {
        column: list.contains('aee-table-wrap--in-last-column'),
        row: list.contains('aee-table-wrap--in-last-row'),
      };
    };

    caretInto(cells[0]); // (0,0) — neither edge
    expect(classes()).toEqual({ column: false, row: false });
    caretInto(cells[1]); // (0,1) — last column only
    expect(classes()).toEqual({ column: true, row: false });
    caretInto(cells[2]); // (1,0) — last row only
    expect(classes()).toEqual({ column: false, row: true });
    caretInto(cells[3]); // (1,1) — both edges
    expect(classes()).toEqual({ column: true, row: true });
  });

  it('marks selection-boundary edges per cell, assembling one rectangle', () => {
    editor.commands['insertTable'](2, 2);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
      return true;
    });
    const edgeClasses = () =>
      [...host.querySelectorAll('td')].map((td) =>
        ['aee-sel-top', 'aee-sel-bottom', 'aee-sel-left', 'aee-sel-right']
          .filter((cls) => td.classList.contains(cls))
          .join(','),
      );

    // Full grid: each corner cell carries its two outer edges.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[3])));
      return true;
    });
    expect(edgeClasses()).toEqual([
      'aee-sel-top,aee-sel-left',
      'aee-sel-top,aee-sel-right',
      'aee-sel-bottom,aee-sel-left',
      'aee-sel-bottom,aee-sel-right',
    ]);

    // One row: its cells carry top AND bottom — the rectangle is one cell tall.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(CellSelection.create(state.doc, cells[0], cells[1])));
      return true;
    });
    expect(edgeClasses()).toEqual([
      'aee-sel-top,aee-sel-bottom,aee-sel-left',
      'aee-sel-top,aee-sel-bottom,aee-sel-right',
      '',
      '',
    ]);

    // (A cell selection also puts ProseMirror-hideselection on the root so
    // the app's CSS can blank the raw DOM selection and caret — but the class
    // rides selectionToDOM, which only runs for a *focused* view, so that
    // half is verified in the browser, not here.)

    // A text selection clears every edge class.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, cells[0] + 1)));
      return true;
    });
    expect(edgeClasses()).toEqual(['', '', '', '']);
  });

  it('refuses a boundary outside the table', () => {
    editor.commands['insertTable'](2, 2);
    expect(editor.exec(setColumnBoundary(tablePos(), 1, 50))).toBe(false); // table edge
    expect(editor.exec(setColumnBoundary(tablePos(), -1, 50))).toBe(false);
  });

  it('renders one full-height line per interior boundary, placed by the model', () => {
    editor.commands['insertTable'](2, 3);
    // The edge handle shares the visual class; boundaries are the non-edge ones.
    const lines = host.querySelectorAll<HTMLElement>('.aee-col-line:not(.aee-col-line--edge)');
    // Two boundaries for three columns — and their positions come from the
    // cumulative shares, no layout measurement involved.
    expect(lines.length).toBe(2);
    expect(Math.round(parseFloat(lines[0].style.left))).toBe(33);
    expect(Math.round(parseFloat(lines[1].style.left))).toBe(67);
  });

  it('moves the line to the committed boundary', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec(setColumnBoundary(tablePos(), 0, 30));
    const line = host.querySelector<HTMLElement>('.aee-col-line')!;
    expect(Math.round(parseFloat(line.style.left))).toBe(30);
  });

  it('places boundary lines against the wrapper box, not the table alone', () => {
    editor.commands['insertTable'](2, 2);
    // A 60%-wide table offset 20%: its midpoint boundary sits at 50% of the
    // *wrapper* (20 + 60/2), which is the coordinate space the lines layer
    // measures in now that the gutter insets it.
    editor.exec(setTableBox(tablePos(), 20, 60));
    const line = host.querySelector<HTMLElement>('.aee-col-line')!;
    expect(Math.round(parseFloat(line.style.left))).toBe(50);
  });

  it('hides the line where every row is spanned across the boundary', () => {
    editor.setContent(
      '<div>intro</div>' +
        '<table><tbody><tr><td colspan="2">w</td></tr></tbody></table>',
    );
    // One boundary exists in the grid, but no row has a cell edge on it —
    // dragging it would move nothing, so it does not offer itself.
    const line = host.querySelector<HTMLElement>('.aee-col-line')!;
    expect(line.style.display).toBe('none');
  });

  it('shows the line when any row has a real edge on the boundary', () => {
    editor.setContent(
      '<div>intro</div>' +
        '<table><tbody><tr><td colspan="2">w</td></tr>' +
        '<tr><td>a</td><td>b</td></tr></tbody></table>',
    );
    const line = host.querySelector<HTMLElement>('.aee-col-line')!;
    expect(line.style.display).toBe('');
  });

  it('keeps cells textually clean and everything out of the serialization', () => {
    editor.commands['insertTable'](2, 2);
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('hello'));
      return true;
    });
    expect(host.querySelector('td')?.textContent).toBe('hello');
    const html = editor.getHTML();
    expect(html).not.toContain('aee-col-line');
    expect(html).not.toContain('aee-table-wrap');
  });
});
