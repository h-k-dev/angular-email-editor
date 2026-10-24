/**
 * The table's `+` pills dragged, in real layout — `npm run test:render`, in
 * Chromium (a drag's step is a share of the table's room or a row's
 * height, and a band goes past its middle — sizes jsdom does not lay out).
 */
import { TableMap } from 'prosemirror-tables';
import { undo } from 'prosemirror-history';
import { Node } from 'prosemirror-model';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  TABLE_EXTEND_BADGE_CLASS,
  columnWidths,
  setColumnBoundary,
  setTableBox,
} from './column-resize';
import { TABLE_COLUMNS } from './nodes/table';

describe('table + pills dragged (render)', () => {
  let host: HTMLElement;
  let editor: Editor;

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const table = (): Node | null => {
    let found: Node | null = null;
    editor.state.doc.forEach((node) => {
      if (node.type.name === 'table') found = node;
    });
    return found;
  };
  const tablePos = (): number => {
    let at = -1;
    editor.state.doc.forEach((node, pos) => {
      if (node.type.name === 'table') at = pos;
    });
    return at;
  };
  /** The table at `width` percent of its room, its columns scaled with it —
      room for a drag to add columns in. */
  const narrow = (width: number) => editor.exec(setTableBox(tablePos(), 0, width));
  const columns = () => TableMap.get(table()!).width;
  const rows = () => TableMap.get(table()!).height;
  const pill = (axis: 'column' | 'row') =>
    host.querySelector<HTMLElement>(`.aee-add-pill--${axis}`)!;
  const badge = () => document.querySelector<HTMLElement>(`.${TABLE_EXTEND_BADGE_CLASS}`);
  const pointer = (type: string, x: number, y: number, target: EventTarget = window) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        clientX: x,
        clientY: y,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );

  /** Presses the pill and moves the pointer by `steps` of its band — half a
      default column (a sixth of the table's room), or the last row's
      height — a frame at a time, without letting go. */
  const drag = async (axis: 'column' | 'row', steps: number) => {
    const rect = pill(axis).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const step =
      axis === 'column'
        ? host.querySelector('.aee-table-box')!.getBoundingClientRect().width / (TABLE_COLUMNS * 2)
        : [...host.querySelectorAll('tr')].at(-1)!.getBoundingClientRect().height;
    pointer('pointerdown', x, y, pill(axis));
    const to = (by: number) =>
      axis === 'column' ? ([x + by * step, y] as const) : ([x, y + by * step] as const);
    const move = async (by: number) => {
      pointer('pointermove', ...to(by));
      await frame();
    };
    await move(steps / 2);
    await move(steps);
    return { move, release: (by = steps) => pointer('pointerup', ...to(by)) };
  };

  beforeEach(() => {
    host = document.createElement('div');
    host.style.cssText = 'width: 600px; font: 16px/20px sans-serif;';
    document.body.append(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>x</div>' });
    // Two columns, three steps wide each; a drag in takes one a step, as
    // Notion's does, however wide it is.
    editor.commands['insertTable'](2, 2);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('a drag right adds a column per half-column step, live, and lands as one undo step', async () => {
    narrow(50);
    const before = editor.getHTML();
    const gesture = await drag('column', 2.2);
    expect(columns()).toBe(4);
    expect(document.body.style.cursor).toBe('col-resize');
    gesture.release();
    expect(columns()).toBe(4);
    expect(document.body.style.cursor).toBe('');
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.getHTML()).toBe(before);
  });

  it('a quarter step of slack before the first column out', async () => {
    narrow(50);
    const gesture = await drag('column', 0.2);
    expect(columns()).toBe(2);
    await gesture.move(0.3);
    expect(columns()).toBe(3);
    gesture.release(0.3);
  });

  it('a column goes a step in — however wide it is — and the table and its pill shrink with it', async () => {
    const gesture = await drag('column', -0.2);
    expect(columns()).toBe(2);
    await gesture.move(-1.2);
    expect(columns()).toBe(1);
    // The column left keeps its size: the table is half as wide.
    expect(table()!.attrs['width']).toBe(50);
    // Its pill rides the edge (placed off the model, as ever).
    expect(host.querySelector<HTMLElement>('.aee-add-zone--column')!.style.left).toBe('50%');
    gesture.release(-1.2);
    expect(columns()).toBe(1);
  });

  it('a narrower table grows by a step per new column, until it fills its room', async () => {
    const shrink = await drag('column', -1.2);
    shrink.release(-1.2);
    expect(table()!.attrs['width']).toBe(50);

    const grow = await drag('column', 1.2);
    expect(columns()).toBe(2);
    expect(table()!.attrs['width']).toBeCloseTo(66.7, 1);
    await grow.move(5.2);
    // Full at the third: the drag stops there, the first column still half.
    expect(columns()).toBe(4);
    expect(table()!.attrs['width']).toBe(100);
    expect(columnWidths(table()!)[0]).toBe(50);
    grow.release(5.2);
  });

  it('a full table takes no column from a drag — none there shrinks — and the way back starts at once', async () => {
    const before = columnWidths(table()!);
    const gesture = await drag('column', 3);
    expect(columns()).toBe(2);
    expect(columnWidths(table()!)).toEqual(before);
    expect(badge()?.textContent).toBe('2 × 2');
    // The travel past the room is dropped: a step back takes one away.
    await gesture.move(1.8);
    expect(columns()).toBe(1);
    gesture.release(1.8);
  });

  it('the last column a drag adds takes what is left of the room, and the table ends full', async () => {
    narrow(90);
    const gesture = await drag('column', 4);
    expect(columns()).toBe(3);
    expect(table()!.attrs['width']).toBe(100);
    expect(columnWidths(table()!)).toEqual([45, 45, 10]);
    gesture.release(4);
  });

  it('a click on a full table still adds one, the columns sharing the room', () => {
    const rect = pill('column').getBoundingClientRect();
    pointer('pointerdown', rect.left + 2, rect.top + 2, pill('column'));
    pointer('pointerup', rect.left + 2, rect.top + 2);
    expect(columns()).toBe(3);
    expect(table()!.attrs['width']).toBe(100);
  });

  it('every boundary line stands on its column edge after a drag changes the width', async () => {
    narrow(50);
    const lines = () => [
      ...host.querySelectorAll<HTMLElement>('.aee-col-boundaries > .aee-col-line'),
    ];
    const check = () => {
      const layer = host.querySelector('.aee-col-lines')!.getBoundingClientRect();
      const edges = [...host.querySelectorAll('tr:first-child td')]
        .slice(0, -1)
        .map((td) => td.getBoundingClientRect().right);
      const placed = lines().map(
        (line) => layer.left + (parseFloat(line.style.left) / 100) * layer.width,
      );
      expect(placed.length).toBe(edges.length);
      placed.forEach((x, i) => expect(Math.abs(x - edges[i])).toBeLessThan(1.5));
    };
    check();
    const gesture = await drag('column', 2.2);
    expect(columns()).toBe(4);
    check();
    gesture.release();
    check();
    // And after undo, the table back at half its room.
    undo(editor.state, editor.view.dispatch);
    check();
  });

  it('past its last band an empty table fades, and let go there it is taken away — one undo step', async () => {
    const before = editor.getHTML();
    // A few steps away, wherever the table's left edge is.
    const gesture = await drag('column', -2.3);
    expect(host.querySelector('.aee-table-wrap')!.classList).toContain('aee-table-wrap--going');
    expect(badge()?.textContent).toBe('0 × 2');
    // Its pill stands at the table's very left edge, as Notion's does at 0.
    const zone = () => host.querySelector<HTMLElement>('.aee-add-zone--column')!.style.left;
    expect(zone()).toBe('0%');
    // On the way back it is a table again — a fresh mini, held at the
    // narrowest a table may be (MIN_TABLE_PCT) — the pill at its edge.
    await gesture.move(-1.3);
    expect(host.querySelector('.aee-table-wrap')!.classList).not.toContain('aee-table-wrap--going');
    expect(badge()?.textContent).toBe('1 × 2');
    expect(zone()).toBe('20%');
    await gesture.move(-2.3);
    gesture.release(-2.3);
    expect(table()).toBeNull();
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.getHTML()).toBe(before);
  });

  it('past 0 and out again: fresh minis, until the start brings the columns back — Notion’s', async () => {
    editor.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>x</div>' });
    editor.commands['insertTable'](); // 3 × 3, a third each
    const width = () => table()!.attrs['width'];
    const gesture = await drag('column', -3.3);
    expect(badge()?.textContent).toBe('0 × 3');
    // One mini — no narrower than a table may be — then two.
    await gesture.move(-2.3);
    expect([columns(), width()]).toEqual([1, 20]);
    await gesture.move(-1.3);
    expect([columns(), width()]).toEqual([2, 33.3]);
    // The start: the three it had, not three minis.
    await gesture.move(-0.3);
    expect([columns(), width()]).toEqual([3, 100]);
    expect(columnWidths(table()!)).toEqual([null, null, null]);
    // In from the start, the columns it had go — the big one stays first.
    await gesture.move(-2.3);
    expect([columns(), width()]).toEqual([1, 33.3]);
    // Let go on a mini (past 0 and one out), and the next drag starts from
    // it: minis out.
    await gesture.move(-3.3);
    await gesture.move(-2.3);
    gesture.release(-2.3);
    expect([columns(), width()]).toEqual([1, 20]);
    const again = await drag('column', 1.2);
    // The column it starts from is the 20% it was let go at, and a mini more.
    expect([columns(), width()]).toEqual([2, 36.7]);
    again.release(1.2);
  });

  it('back at the start, the very columns it had: their widths come back', async () => {
    editor.exec(setColumnBoundary(tablePos(), 0, 70));
    const widths = () =>
      [...host.querySelectorAll('tr:first-child td')].map((td) => (td as HTMLElement).style.width);
    expect(widths()).toEqual(['70%', '30%']);
    const gesture = await drag('column', -1);
    expect(columns()).toBe(1);
    await gesture.move(0);
    expect(widths()).toEqual(['70%', '30%']);
    gesture.release(0);
  });

  it('never takes away a column with words in it, nor the table round them', async () => {
    const cells = host.querySelectorAll('td');
    const pos = editor.view.posAtDOM(cells[cells.length - 1], 0);
    editor.view.dispatch(editor.state.tr.insertText('kept', pos));
    const gesture = await drag('column', -6);
    expect(columns()).toBe(2);
    expect(host.querySelector('.aee-table-wrap')!.classList).not.toContain('aee-table-wrap--going');
    gesture.release(-6);
    expect(columns()).toBe(2);
  });

  it('a badge by the pointer says columns × rows while it drags, and goes with the drag', async () => {
    narrow(50);
    const gesture = await drag('column', 1.2);
    expect(badge()?.textContent).toBe('3 × 2');
    await gesture.move(-1.2);
    expect(badge()?.textContent).toBe('1 × 2');
    gesture.release(-1.2);
    expect(badge()).toBeNull();
  });

  it('a drag down adds rows by the last row’s height; Escape puts the table back', async () => {
    const before = editor.getHTML();
    const gesture = await drag('row', 3);
    expect(rows()).toBe(5);
    expect(badge()?.textContent).toBe('2 × 5');
    expect(document.body.style.cursor).toBe('row-resize');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.getHTML()).toBe(before);
    expect(badge()).toBeNull();
    gesture.release();
    expect(editor.getHTML()).toBe(before);
    expect(document.body.style.cursor).toBe('');
  });

  it('released in place, a press is the click: one step of the drag', () => {
    const rect = pill('row').getBoundingClientRect();
    pointer('pointerdown', rect.left + 2, rect.top + 2, pill('row'));
    pointer('pointerup', rect.left + 2, rect.top + 2);
    expect(rows()).toBe(3);
  });
});
