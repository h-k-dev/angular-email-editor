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
