import { TextSelection } from 'prosemirror-state';
import { createEditor } from '../editor';
import { emailExtensions } from './kits';
import { BubbleMenuOptions, BubbleMenuState, createBubbleMenu } from './bubble-menu';

describe('bubble menu anchor', () => {
  afterEach(() => vi.useRealTimers());

  /** An editor with the menu, focused, on a DOM whose geometry is the
      position itself: position n stands at x = 10n on one 10px line. */
  function mount(anchor?: BubbleMenuOptions['anchor']) {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const states: BubbleMenuState[] = [];
    const editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createBubbleMenu({ updateDelay: 0, anchor, onStateChange: (state) => states.push(state) }),
      ],
      content: '<div>hello wonderful world</div>',
    });
    editor.view.hasFocus = () => true;
    editor.view.coordsAtPos = (pos: number) => ({
      left: pos * 10,
      right: pos * 10,
      top: 0,
      bottom: 10,
    });
    const select = (from: number, to: number) => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
      );
      vi.runAllTimers();
    };
    const last = () => states[states.length - 1];
    const unmount = () => {
      editor.destroy();
      host.remove();
    };
    return { editor, select, last, unmount };
  }

  it('stands where it opened while the selection grows under it', () => {
    const { select, last, unmount } = mount();
    select(1, 6);
    expect(last()).toMatchObject({ isOpen: true, kind: 'text' });
    expect(last().boundingBox).toMatchObject({ left: 10, right: 60 });

    // Shift-Arrow, a handle dragged further: the menu does not move.
    select(1, 16);
    expect(last().isOpen).toBe(true);
    expect(last().boundingBox).toMatchObject({ left: 10, right: 60 });
    unmount();
  });

  it('measures afresh once it has closed and opens again', () => {
    const { select, last, unmount } = mount();
    select(1, 6);
    select(3, 3); // collapsed: the menu goes
    expect(last().isOpen).toBe(false);
    select(7, 16);
    expect(last().boundingBox).toMatchObject({ left: 70, right: 160 });
    unmount();
  });

  it("follows the selection with anchor: 'selection'", () => {
    const { select, last, unmount } = mount('selection');
    select(1, 6);
    select(1, 16);
    expect(last().boundingBox).toMatchObject({ left: 10, right: 160 });
    unmount();
  });
});

describe('bubble menu holdsFocus', () => {
  afterEach(() => vi.useRealTimers());

  /** A focused editor with its menu open over a word, and a pane of the
      menu's own outside the editor holding a field. */
  function mount(holdsFocus?: BubbleMenuOptions['holdsFocus']) {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const pane = document.createElement('div');
    pane.setAttribute('data-pane', '');
    const field = document.createElement('input');
    pane.appendChild(field);
    const elsewhere = document.createElement('input');
    document.body.append(host, pane, elsewhere);
    const states: BubbleMenuState[] = [];
    const editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createBubbleMenu({
          updateDelay: 0,
          holdsFocus,
          onStateChange: (state) => states.push(state),
        }),
      ],
      content: '<div>hello world</div>',
    });
    editor.view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 10 });
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    );
    vi.runAllTimers();
    /** The focus moving to `element`, as a press there moves it. */
    const focus = (element: HTMLElement) => {
      element.focus();
      vi.runAllTimers();
    };
    const last = () => states[states.length - 1];
    const unmount = () => {
      editor.destroy();
      host.remove();
      pane.remove();
      elsewhere.remove();
    };
    return { field, elsewhere, focus, last, unmount };
  }

  it('closes once the editor loses the focus, by default', () => {
    const { field, focus, last, unmount } = mount();
    expect(last().isOpen).toBe(true);
    focus(field);
    expect(last().isOpen).toBe(false);
    unmount();
  });

  it('stays open while the focus is in one of its own parts — and goes once it leaves them', () => {
    for (const holds of ['[data-pane]', (el: Element) => !!el.closest('[data-pane]')]) {
      const { field, elsewhere, focus, last, unmount } = mount(holds);
      focus(field);
      expect(last().isOpen).toBe(true);
      focus(elsewhere);
      expect(last().isOpen).toBe(false);
      unmount();
    }
  });
});
