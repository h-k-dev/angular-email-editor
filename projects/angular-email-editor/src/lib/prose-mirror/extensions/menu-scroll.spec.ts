import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { richTextExtensions, emailExtensions } from './kits';
import { BubbleMenuState, createBubbleMenu } from './bubble-menu';
import { BlockMenuState, createBlockMenu } from './block-menu';
import { MenuScroll } from './menu-scroll';

/** The editor inside a scroll container, as a composer has it. */
function mount(): { scroller: HTMLElement; host: HTMLElement } {
  const scroller = document.createElement('div');
  const host = document.createElement('div');
  scroller.appendChild(host);
  document.body.appendChild(scroller);
  return { scroller, host };
}

const scrollOf = (el: EventTarget) => el.dispatchEvent(new Event('scroll', { bubbles: false }));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const flushShowTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('a floating menu when the editor scrolls under it', () => {
  describe('the bubble menu', () => {
    let editor: Editor;
    let scroller: HTMLElement;
    let host: HTMLElement;
    let states: BubbleMenuState[];

    const open = (scroll?: MenuScroll) => {
      ({ scroller, host } = mount());
      states = [];
      editor = createEditor({
        parent: host,
        extensions: [
          ...richTextExtensions,
          createBubbleMenu({ updateDelay: 0, scroll, onStateChange: (s) => states.push(s) }),
        ],
        content: '<p>Hello world</p>',
      });
      vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      });
      vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
      document.elementFromPoint ??= () => null;
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
        return true;
      });
    };

    afterEach(() => {
      editor.destroy();
      scroller.remove();
    });

    it('closes by default when its scroll container scrolls — and says so once', async () => {
      open();
      await flushShowTimer();
      expect(states.at(-1)?.isOpen).toBe(true);
      const before = states.length;

      scrollOf(scroller);
      expect(states.at(-1)).toEqual({ isOpen: false, boundingBox: null });
      expect(states.length).toBe(before + 1);

      scrollOf(scroller);
      expect(states.length).toBe(before + 1);
    });

    it('closes on the document’s own scroll too', async () => {
      open();
      await flushShowTimer();
      scrollOf(document);
      expect(states.at(-1)?.isOpen).toBe(false);
    });

    it('ignores a scroll that does not move the editor — a list inside the host’s menu', async () => {
      open();
      await flushShowTimer();
      const before = states.length;
      const elsewhere = document.createElement('div');
      document.body.appendChild(elsewhere);
      scrollOf(elsewhere);
      elsewhere.remove();
      expect(states.length).toBe(before);
      expect(states.at(-1)?.isOpen).toBe(true);
    });

    it('follows: reports the box afresh, once per frame, while open', async () => {
      open('follow');
      await flushShowTimer();
      const before = states.length;
      scrollOf(scroller);
      scrollOf(scroller);
      expect(states.length).toBe(before);
      await nextFrame();
      expect(states.length).toBe(before + 1);
      expect(states.at(-1)?.isOpen).toBe(true);
      expect(states.at(-1)?.boundingBox).not.toBeNull();
    });

    it('keeps: nothing happens', async () => {
      open('keep');
      await flushShowTimer();
      const before = states.length;
      scrollOf(scroller);
      await nextFrame();
      expect(states.length).toBe(before);
    });

    it('lets the host decide per event', async () => {
      const scroll = vi.fn((event: Event, menu: { close(): void }) => {
        if (event.target === scroller) menu.close();
      });
      open(scroll);
      await flushShowTimer();
      scrollOf(document);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(states.at(-1)?.isOpen).toBe(true);
      scrollOf(scroller);
      expect(states.at(-1)?.isOpen).toBe(false);
    });

    it('stops listening once destroyed', async () => {
      open();
      await flushShowTimer();
      editor.destroy();
      const before = states.length;
      scrollOf(scroller);
      expect(states.length).toBe(before);
      // afterEach destroys again: harmless.
    });
  });

  describe('the block menu', () => {
    it('closes by default, and comes back with the next selection change', () => {
      const { scroller, host } = mount();
      const states: BlockMenuState[] = [];
      const editor = createEditor({
        parent: host,
        extensions: [...emailExtensions, createBlockMenu({ onStateChange: (s) => states.push(s) })],
        content: '<div>intro</div>',
      });
      editor.focus();
      editor.exec((s, dispatch) => {
        dispatch?.(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 1)));
        return true;
      });
      // The cursor lands in the new table: the menu opens on it.
      editor.commands['insertTable']();
      expect(states.at(-1)?.isOpen).toBe(true);
      const before = states.length;

      scrollOf(scroller);
      expect(states.at(-1)?.isOpen).toBe(false);
      scrollOf(scroller);
      expect(states.length).toBe(before + 1);

      // The next selection change brings it back.
      editor.exec((s, dispatch) => {
        dispatch?.(s.tr.setSelection(TextSelection.create(s.doc, s.selection.from + 1)));
        return true;
      });
      expect(states.at(-1)?.isOpen).toBe(true);

      editor.destroy();
      scroller.remove();
    });
  });
});
