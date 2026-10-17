import { AllSelection, Selection, TextSelection } from 'prosemirror-state';
import { createEditor } from '../editor';
import { emailExtensions } from './kits';
import { BLOCK_RELEASING_CLASS, BLOCK_SELECTED_CLASS, BlockSelection } from './block-selection';
import { BLOCK_MARQUEE_CLASS, createBlockMarquee } from './block-marquee';
import { IN_SELECTION_CLASS } from './inline-atom-selection';

// <div>(0) one (5) <div> two (10) <div> three (17) <div> four (23)
const LINES = '<div>one</div><div>two</div><div>three</div><div>four</div>';
const ONE = 0;
const TWO = 5;
const THREE = 10;
const FOUR = 17;

const mount = (content = LINES, extensions = emailExtensions) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor({ parent: host, extensions, content });
  const select = (selection: Selection) =>
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  const blocks = (anchor: number, head = anchor) =>
    select(BlockSelection.create(editor.state.doc, anchor, head));
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const selected = () =>
    Array.from(editor.view.dom.querySelectorAll(`.${BLOCK_SELECTED_CLASS}`)).map(
      (el) => el.textContent,
    );
  return {
    host,
    editor,
    select,
    blocks,
    key,
    selected,
    unmount: () => (editor.destroy(), host.remove()),
  };
};

describe('BlockSelection: whole blocks, selected as blocks', () => {
  it('runs from the anchor block to the head block, either way', () => {
    const { editor, blocks, unmount } = mount();
    blocks(TWO, THREE);
    let { selection } = editor.state;
    expect(selection).toBeInstanceOf(BlockSelection);
    expect([selection.from, selection.to]).toEqual([TWO, FOUR]);
    expect((selection as BlockSelection).blocks.map((b) => b.node.textContent)).toEqual([
      'two',
      'three',
    ]);

    blocks(THREE, TWO);
    selection = editor.state.selection;
    expect([selection.anchor, selection.head]).toEqual([FOUR, TWO]);
    expect((selection as BlockSelection).headIndex).toBe(1);
    expect((selection as BlockSelection).anchorIndex).toBe(2);
    unmount();
  });

  it('takes only the starts of top-level blocks', () => {
    const { editor, unmount } = mount();
    expect(() => BlockSelection.create(editor.state.doc, TWO + 1)).toThrow(RangeError);
    expect(() => BlockSelection.create(editor.state.doc, editor.state.doc.content.size)).toThrow(
      RangeError,
    );
    unmount();
  });

  it('lights every block in it, and only those — no atom highlight on top', () => {
    const { blocks, selected, editor, unmount } = mount(
      '<div>one</div><div>a <img src="x.png" alt="dot"> b</div><div>three</div>',
    );
    blocks(ONE, 5);
    expect(selected()).toEqual(['one', 'a  b']);
    expect(editor.view.dom.querySelector(`.${IN_SELECTION_CLASS}`)).toBeNull();
    // The browser's highlight is hidden (`ProseMirror-hideselection`, once focused).
    expect(editor.state.selection.visible).toBe(false);
    unmount();
  });

  it('copies as the blocks, whole', () => {
    const { editor, blocks, unmount } = mount();
    blocks(TWO, THREE);
    const slice = editor.state.selection.content();
    expect([slice.openStart, slice.openEnd]).toEqual([0, 0]);
    expect(slice.content.childCount).toBe(2);
    unmount();
  });

  it('keeps to its blocks through a change: a block inserted at a seam lands outside', () => {
    const { editor, blocks, unmount } = mount();
    blocks(TWO, THREE);
    const paragraph = editor.schema.nodes['paragraph'].create(null, editor.schema.text('new'));
    editor.view.dispatch(editor.state.tr.insert(TWO, paragraph).insert(FOUR + 5, paragraph));
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(BlockSelection);
    expect((selection as BlockSelection).blocks.map((b) => b.node.textContent)).toEqual([
      'two',
      'three',
    ]);
    unmount();
  });

  it('falls back to a caret once its blocks are gone', () => {
    const { editor, blocks, unmount } = mount();
    blocks(TWO);
    editor.view.dispatch(editor.state.tr.delete(TWO, THREE));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    unmount();
  });

  it('round-trips through JSON and comes back on undo', () => {
    const { editor, blocks, key, unmount } = mount();
    blocks(THREE, TWO);
    const json = editor.state.selection.toJSON();
    expect(Selection.fromJSON(editor.state.doc, json).eq(editor.state.selection)).toBe(true);
    key('Backspace');
    expect(editor.state.doc.textContent).toBe('onefour');
    key('z', { ctrlKey: true });
    expect(editor.state.doc.textContent).toBe('onetwothreefour');
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
    expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([FOUR, TWO]);
    unmount();
  });
});

describe('SelectedBlocks: the keys', () => {
  it('ArrowUp / ArrowDown walk one block at a time, stopping at the ends', () => {
    const { editor, blocks, key, selected, unmount } = mount();
    blocks(TWO, THREE);
    expect(key('ArrowDown')).toBe(true);
    expect(selected()).toEqual(['four']);
    key('ArrowDown');
    expect(selected()).toEqual(['four']);
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    expect(selected()).toEqual(['one']);
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
    unmount();
  });

  it('Shift-ArrowDown / -Up grow the run from its head and shrink it back', () => {
    const { blocks, key, selected, unmount } = mount();
    blocks(TWO);
    key('ArrowDown', { shiftKey: true });
    key('ArrowDown', { shiftKey: true });
    expect(selected()).toEqual(['two', 'three', 'four']);
    key('ArrowUp', { shiftKey: true });
    key('ArrowUp', { shiftKey: true });
    key('ArrowUp', { shiftKey: true });
    expect(selected()).toEqual(['one', 'two']);
    unmount();
  });

  it('ArrowLeft / ArrowRight leave to the caret at the start or the end', () => {
    const { editor, blocks, key, unmount } = mount();
    blocks(TWO, THREE);
    key('ArrowLeft');
    expect(editor.state.selection.toJSON()).toEqual({
      type: 'text',
      anchor: TWO + 1,
      head: TWO + 1,
    });
    blocks(TWO, THREE);
    key('ArrowRight');
    expect(editor.state.selection.toJSON()).toEqual({
      type: 'text',
      anchor: FOUR - 1,
      head: FOUR - 1,
    });
    unmount();
  });

  it('Enter and Escape leave to the caret in the head block', () => {
    const { editor, blocks, key, unmount } = mount();
    blocks(TWO, THREE);
    key('Enter');
    expect(editor.state.selection.head).toBe(FOUR - 1);
    blocks(THREE, TWO);
    key('Escape');
    expect(editor.state.selection.head).toBe(TWO + 1);
    expect(editor.state.doc.childCount).toBe(4);
    unmount();
  });

  it('Delete removes the blocks; removing every block leaves an empty line', () => {
    const { editor, blocks, select, key, unmount } = mount();
    blocks(TWO, THREE);
    key('Delete');
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.textContent).toBe('onefour');
    select(BlockSelection.all(editor.state.doc));
    key('Backspace');
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.isTextblock).toBe(true);
    expect(editor.state.doc.textContent).toBe('');
    unmount();
  });

  it('Mod-a selects the text first, every block the second time', () => {
    const { editor, select, key, selected, unmount } = mount();
    select(TextSelection.create(editor.state.doc, TWO + 1));
    key('a', { ctrlKey: true });
    expect(editor.state.selection).toBeInstanceOf(AllSelection);
    key('a', { ctrlKey: true });
    expect(editor.state.selection).toBeInstanceOf(BlockSelection);
    expect(selected()).toEqual(['one', 'two', 'three', 'four']);
    unmount();
  });

  it('typing does nothing to selected blocks; a paste is not held back', () => {
    const { editor, blocks, unmount } = mount();
    blocks(TWO);
    const typed = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(true);
    const pasted = new InputEvent('beforeinput', {
      inputType: 'insertFromPaste',
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(pasted);
    expect(pasted.defaultPrevented).toBe(false);
    expect(editor.state.doc.textContent).toBe('onetwothreefour');
    unmount();
  });

  it('leaves the arrows alone outside a block selection', () => {
    const { editor, select, key, unmount } = mount();
    select(TextSelection.create(editor.state.doc, TWO + 1));
    key('ArrowDown');
    expect(editor.state.selection).not.toBeInstanceOf(BlockSelection);
    unmount();
  });

  it('a press outside the editor lets the blocks go — unless the editor keeps its focus', async () => {
    const { editor, blocks, selected, unmount } = mount();
    const field = document.createElement('input');
    const tool = document.createElement('button');
    // A toolbar button acting on the selection: its press keeps focus where it is.
    tool.addEventListener('mousedown', (event) => event.preventDefault());
    document.body.append(field, tool);
    const tick = () => new Promise((resolve) => setTimeout(resolve));
    const press = (target: Element) =>
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    editor.view.focus();
    blocks(TWO, THREE);
    press(tool);
    await tick();
    expect(selected()).toEqual(['two', 'three']);

    // Another field: the press takes focus there (jsdom moves no focus on a
    // press — the browser's default action, done by hand).
    press(field);
    field.focus();
    await tick();
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection.empty).toBe(true);
    expect(selection.$head.parent.textContent).toBe('three');
    expect(selected()).toEqual([]);

    field.remove();
    tool.remove();
    unmount();
  });

  it('marks the blocks let go as releasing, and drops the mark once no fade runs', async () => {
    const { editor, blocks, key, unmount } = mount();
    const releasing = () =>
      Array.from(editor.view.dom.querySelectorAll(`.${BLOCK_RELEASING_CLASS}`)).map(
        (el) => el.textContent,
      );
    blocks(TWO, THREE);
    expect(releasing()).toEqual([]);
    key('Escape');
    expect(releasing()).toEqual(['two', 'three']);
    // No stylesheet here, so no animation: gone on the next turn.
    await new Promise((resolve) => setTimeout(resolve));
    expect(releasing()).toEqual([]);

    // Selected again before it is over: lit, not releasing.
    blocks(ONE);
    key('Escape');
    blocks(ONE);
    expect(releasing()).toEqual([]);
    unmount();
  });
});

describe('createBlockMarquee: a box dragged from the empty room', () => {
  /** Lays the four lines out 20px apart from y=100, 400px wide at x=50,
      inside a 600x400 surface at the origin — jsdom has no layout. */
  const laidOut = () => {
    const m = mount(LINES, [...emailExtensions, createBlockMarquee()]);
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
      }) as DOMRect;
    const box = (el: Element, r: DOMRect) => (el.getBoundingClientRect = () => r);
    box(m.host, rect(0, 0, 600, 400));
    Object.defineProperty(m.host, 'clientWidth', { value: 600 });
    Object.defineProperty(m.host, 'clientHeight', { value: 400 });
    box(m.editor.view.dom, rect(50, 90, 400, 300));
    Array.from(m.editor.view.dom.children).forEach((line, i) =>
      box(line, rect(50, 100 + i * 20, 400, 20)),
    );
    return m;
  };
  const mouse = (
    target: EventTarget,
    type: string,
    x: number,
    y: number,
    init: MouseEventInit = {},
  ) => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      button: 0,
      detail: type === 'mousedown' ? 1 : 0,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };

  it('selects the run of blocks the box touches, drawn in the surface', () => {
    const { host, editor, selected, unmount } = laidOut();
    const down = mouse(host, 'mousedown', 20, 105);
    expect(down.defaultPrevented).toBe(true);
    mouse(window, 'mousemove', 60, 125);
    expect(selected()).toEqual(['one', 'two']);
    const box = host.querySelector<HTMLElement>(`.${BLOCK_MARQUEE_CLASS}`)!;
    expect(box).not.toBeNull();
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
      '20px',
      '105px',
      '40px',
      '20px',
    ]);
    mouse(window, 'mousemove', 60, 150);
    expect(selected()).toEqual(['one', 'two', 'three']);
    mouse(window, 'mouseup', 60, 150);
    expect(host.querySelector(`.${BLOCK_MARQUEE_CLASS}`)).toBeNull();
    expect(selected()).toEqual(['one', 'two', 'three']);
    expect(editor.state.selection.head).toBe(FOUR);
    unmount();
  });

  it('dragged upward, the head is the top block', () => {
    const { host, editor, unmount } = laidOut();
    mouse(host, 'mousedown', 20, 165);
    mouse(window, 'mousemove', 60, 125);
    mouse(window, 'mouseup', 60, 125);
    const selection = editor.state.selection as BlockSelection;
    expect(selection.blocks.map((b) => b.node.textContent)).toEqual(['two', 'three', 'four']);
    expect(selection.head).toBe(TWO);
    unmount();
  });

  it('starts from the editor’s own room, never from a block', () => {
    const { editor, selected, unmount } = laidOut();
    // jsdom has no hit-testing: ProseMirror's own press finds nothing.
    editor.view.posAtCoords = () => null;
    const onLine = mouse(editor.view.dom.children[1], 'mousedown', 60, 125);
    expect(onLine.defaultPrevented).toBe(false);
    mouse(window, 'mousemove', 60, 165);
    mouse(window, 'mouseup', 60, 165);
    expect(selected()).toEqual([]);

    const onRoom = mouse(editor.view.dom, 'mousedown', 455, 95);
    expect(onRoom.defaultPrevented).toBe(true);
    mouse(window, 'mousemove', 300, 112);
    mouse(window, 'mouseup', 300, 112);
    expect(selected()).toEqual(['one']);
    unmount();
  });

  it('a box touching no block gives the press’s selection back; Escape cancels', () => {
    const { host, editor, select, selected, unmount } = laidOut();
    select(TextSelection.create(editor.state.doc, THREE + 2));
    const before = editor.state.selection;
    mouse(host, 'mousedown', 10, 10);
    mouse(window, 'mousemove', 60, 105);
    expect(selected()).toEqual(['one']);
    mouse(window, 'mousemove', 40, 40);
    expect(editor.state.selection.eq(before)).toBe(true);
    mouse(window, 'mousemove', 60, 145);
    expect(selected()).toEqual(['one', 'two', 'three']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(editor.state.selection.eq(before)).toBe(true);
    expect(host.querySelector(`.${BLOCK_MARQUEE_CLASS}`)).toBeNull();
    unmount();
  });

  it('a press released in place is a click: the caret at the nearest spot', () => {
    const { host, editor, unmount } = laidOut();
    const asked: { left: number; top: number }[] = [];
    editor.view.posAtCoords = (coords) => (asked.push(coords), { pos: THREE + 1, inside: -1 });
    mouse(host, 'mousedown', 10, 145);
    mouse(window, 'mousemove', 12, 146);
    mouse(window, 'mouseup', 12, 146);
    // The margin's point, brought onto the editor's box.
    expect(asked).toEqual([{ left: 51, top: 145 }]);
    expect(editor.state.selection.toJSON()).toEqual({
      type: 'text',
      anchor: THREE + 1,
      head: THREE + 1,
    });
    expect(host.querySelector(`.${BLOCK_MARQUEE_CLASS}`)).toBeNull();
    unmount();
  });

  it('leaves the surface’s controls, modifier presses and double-clicks alone', () => {
    const { host, unmount } = laidOut();
    const button = document.createElement('button');
    host.appendChild(button);
    expect(mouse(button, 'mousedown', 10, 10).defaultPrevented).toBe(false);
    expect(mouse(host, 'mousedown', 10, 10, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(mouse(host, 'mousedown', 10, 10, { detail: 2 }).defaultPrevented).toBe(false);
    unmount();
  });
});
