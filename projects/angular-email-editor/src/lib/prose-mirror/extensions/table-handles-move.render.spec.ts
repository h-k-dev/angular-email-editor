/**
 * A band dragged by its grip — Notion's drag-to-move — in real layout:
 * `npm run test:render`, in Chromium (the band under the pointer and the
 * drop line's place are layout, which jsdom does not do).
 */
import { undo } from 'prosemirror-history';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import {
  BAND_DROP_CLASS,
  BAND_GHOST_CLASS,
  BAND_MOVING_CLASS,
  TableHandleTarget,
  createTableHandles,
} from './table-handles';

describe('band drag-to-move (render)', () => {
  let host: HTMLElement;
  let editor: Editor;
  let opened: (TableHandleTarget | null)[];

  const grip = (kind: 'row' | 'column', index: number) =>
    host.querySelector<HTMLElement>(`.aee-grip--${kind}[data-index="${index}"]`)!;
  const cell = (row: number, column: number) =>
    host.querySelectorAll('tr')[row].querySelectorAll('td')[column];
  const text = () =>
    [...host.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent).join(' '),
    );
  const line = () => host.querySelector<HTMLElement>(`.${BAND_DROP_CLASS}`);
  const mouse = (type: string, x: number, y: number, target: EventTarget = window) =>
    target.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }),
    );
  const centre = (el: Element) => {
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  /** Presses a grip and moves the pointer onto `over`, without letting go. */
  const press = (kind: 'row' | 'column', index: number) => {
    const at = centre(grip(kind, index));
    mouse('mousedown', at.x, at.y, grip(kind, index));
    return (over: Element) => {
      const to = centre(over);
      mouse('mousemove', kind === 'column' ? to.x : at.x, kind === 'row' ? to.y : at.y);
    };
  };

  beforeEach(() => {
    host = document.createElement('div');
    host.style.cssText = 'width: 600px; font: 16px/20px sans-serif;';
    document.body.append(host);
    opened = [];
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createTableHandles({ onOpen: (target) => opened.push(target) }),
      ],
      content:
        '<table><tbody><tr><td>a1</td><td>a2</td><td>a3</td></tr>' +
        '<tr><td>b1</td><td>b2</td><td>b3</td></tr>' +
        '<tr><td>c1</td><td>c2</td><td>c3</td></tr></tbody></table>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('dragged, a column hides what is in it and nothing else moves', () => {
    const before = cell(0, 1).getBoundingClientRect().left;
    const to = press('column', 0);
    to(cell(0, 2));
    expect(cell(0, 0).classList).toContain(BAND_MOVING_CLASS);
    expect(cell(2, 0).classList).toContain(BAND_MOVING_CLASS);
    expect(cell(0, 1).classList).not.toContain(BAND_MOVING_CLASS);
    expect(cell(0, 1).getBoundingClientRect().left).toBe(before);
    mouse('mouseup', 0, 0);
    expect(host.querySelector(`.${BAND_MOVING_CLASS}`)).toBeNull();
  });

  it('the band under the pointer decides: the line on its far edge — none over its own', () => {
    const wrap = host.querySelector('.aee-table-wrap')!.getBoundingClientRect();
    const to = press('column', 0);
    to(cell(0, 2));
    expect(line()?.style.display).toBe('');
    // Past the dragged band: its right edge.
    expect(parseFloat(line()!.style.left) + wrap.left).toBeCloseTo(
      cell(0, 2).getBoundingClientRect().right,
      0,
    );
    to(cell(0, 1));
    expect(parseFloat(line()!.style.left) + wrap.left).toBeCloseTo(
      cell(0, 1).getBoundingClientRect().right,
      0,
    );
    to(cell(0, 0));
    expect(line()!.style.display).toBe('none');
    mouse('mouseup', 0, 0);
    expect(line()).toBeNull();
    expect(text()[0]).toBe('a1 a2 a3');
  });

  it('released, the column lands there as one undo step — and the click opens nothing', () => {
    const to = press('column', 2);
    // Ahead of the dragged band: the line on the band's left edge, before it.
    to(cell(0, 0));
    const wrap = host.querySelector('.aee-table-wrap')!.getBoundingClientRect();
    expect(parseFloat(line()!.style.left) + wrap.left).toBeCloseTo(
      cell(0, 0).getBoundingClientRect().left,
      0,
    );
    const at = centre(cell(0, 0));
    mouse('mouseup', at.x, at.y);
    expect(text()).toEqual(['a3 a1 a2', 'b3 b1 b2', 'c3 c1 c2']);
    expect(opened).toEqual([]);
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(text()).toEqual(['a1 a2 a3', 'b1 b2 b3', 'c1 c2 c3']);
  });

  it('rows the same way: down past a row, it lands after it', () => {
    const to = press('row', 0);
    to(cell(1, 0));
    const at = centre(cell(1, 0));
    mouse('mouseup', at.x, at.y);
    expect(text()).toEqual(['b1 b2 b3', 'a1 a2 a3', 'c1 c2 c3']);
  });

  it('the hand holds a copy of the band, along the axis where it was grabbed — and the cursor is grabbing', () => {
    const grabbedAt = centre(grip('column', 0));
    const offset = grabbedAt.x - cell(0, 0).getBoundingClientRect().left;
    const to = press('column', 0);
    to(cell(0, 2));
    const ghost = host.querySelector<HTMLElement>(`.${BAND_GHOST_CLASS}`)!;
    expect(ghost.classList).toContain(`${BAND_GHOST_CLASS}--column`);
    // Its own cells, as drawn — and its own grip, held open; no other grip.
    expect([...ghost.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['a1', 'b1', 'c1']);
    expect(ghost.querySelectorAll('.aee-grip').length).toBe(1);
    expect(ghost.querySelector('.aee-grip--column')!.getAttribute('aria-expanded')).toBe('true');
    expect(ghost.querySelector(`.${BAND_MOVING_CLASS}`)).toBeNull();
    // Under the pointer, kept where it was grabbed; level with the table.
    expect(ghost.getBoundingClientRect().left).toBeCloseTo(centre(cell(0, 2)).x - offset, 0);
    expect(ghost.getBoundingClientRect().top).toBeCloseTo(
      host.querySelector('table')!.getBoundingClientRect().top,
      0,
    );
    expect(document.documentElement.hasAttribute('data-aee-drag')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--aee-drag-cursor')).toBe('grabbing');
    mouse('mouseup', 0, 0);
    expect(host.querySelector(`.${BAND_GHOST_CLASS}`)).toBeNull();
    expect(document.documentElement.hasAttribute('data-aee-drag')).toBe(false);
  });

  it('a row’s copy is the whole row, moving up and down', () => {
    const to = press('row', 0);
    to(cell(2, 0));
    const ghost = host.querySelector<HTMLElement>(`.${BAND_GHOST_CLASS}`)!;
    expect([...ghost.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['a1', 'a2', 'a3']);
    expect(ghost.getBoundingClientRect().left).toBeCloseTo(
      host.querySelector('table')!.getBoundingClientRect().left,
      0,
    );
    mouse('mouseup', 0, 0);
  });

  it('Escape lets the band go untouched', () => {
    const to = press('column', 0);
    to(cell(0, 2));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(line()).toBeNull();
    expect(host.querySelector(`.${BAND_MOVING_CLASS}`)).toBeNull();
    mouse('mouseup', 0, 0);
    expect(text()[0]).toBe('a1 a2 a3');
  });

  it('a press that stays put is still the click: the band is selected and its menu asked for', () => {
    const at = centre(grip('column', 1));
    mouse('mousedown', at.x, at.y, grip('column', 1));
    mouse('mouseup', at.x, at.y, grip('column', 1));
    mouse('click', at.x, at.y, grip('column', 1));
    expect(opened.length).toBe(1);
    expect(opened[0]).toMatchObject({ kind: 'column', index: 1 });
    expect(line()).toBeNull();
  });
});
