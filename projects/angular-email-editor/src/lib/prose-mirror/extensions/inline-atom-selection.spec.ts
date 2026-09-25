import { DOMParser } from 'prosemirror-model';
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { createEditor, isMarkActive } from '../editor';
import { emailExtensions } from './kits';
import { soleInlineAtom } from './inline-atoms';
import { BubbleMenuState, createBubbleMenu } from './bubble-menu';
import { createButtonEdit, selectedButton } from './nodes/button';
import { selectedImage, fitImageWidth } from './nodes/image';

const BUTTON =
  '<a href="https://x.y" style="display: inline-block; background-color: rgb(26, 115, 232); color: rgb(255, 255, 255); font-weight: bold; text-decoration: none; border-width: 14px 28px; border-style: solid; border-color: rgb(26, 115, 232);">Buy</a>';

const mount = (content: string, extra: Parameters<typeof createEditor>[0]['extensions'] = []) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor({
    parent: host,
    extensions: [...emailExtensions, ...extra],
    content,
  });
  const select = (selection: Selection) =>
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  const range = (anchor: number, head: number) =>
    select(TextSelection.create(editor.state.doc, anchor, head));
  const node = (pos: number) => select(NodeSelection.create(editor.state.doc, pos));
  return { editor, select, range, node, unmount: () => (editor.destroy(), host.remove()) };
};

describe('inline atoms: an image or a button selected like a character', () => {
  // <div>(0) h e l l o ␣ → the image sits at 7, " world" from 8.
  const IMAGE_LINE = '<div>hello <img src="x.png" alt="dot"> world</div>';
  const imagePos = 7;

  describe('the atom alone: whitespace around it does not count', () => {
    it('is the image when a range takes the spaces around it, and not when it takes a letter', () => {
      const { editor, range, node, unmount } = mount(IMAGE_LINE);
      node(imagePos);
      expect(soleInlineAtom(editor.state)?.pos).toBe(imagePos);
      range(imagePos, imagePos + 1);
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      // The space before and the space after: still the image alone.
      range(imagePos - 1, imagePos + 2);
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      // Backwards too.
      range(imagePos + 2, imagePos - 1);
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      // The "o" before it: a text selection.
      range(imagePos - 2, imagePos + 1);
      expect(selectedImage(editor.state)).toBeNull();
      // The "w" after it.
      range(imagePos, imagePos + 3);
      expect(selectedImage(editor.state)).toBeNull();
      unmount();
    });

    it('a line break after the image is whitespace; a second atom is not', () => {
      const withBreak = mount('<div>hello <img src="x.png" alt="dot"><br>world</div>');
      withBreak.range(imagePos, imagePos + 2);
      expect(selectedImage(withBreak.editor.state)?.pos).toBe(imagePos);
      withBreak.unmount();

      const two = mount('<div><img src="a.png"> <img src="b.png"></div>');
      two.range(1, 4);
      expect(soleInlineAtom(two.editor.state)).toBeNull();
      two.unmount();

      const mixed = mount(`<div><img src="a.png"> ${BUTTON}</div>`);
      mixed.range(1, 4);
      expect(soleInlineAtom(mixed.editor.state)).toBeNull();
      expect(selectedImage(mixed.editor.state)).toBeNull();
      expect(selectedButton(mixed.editor.state)).toBeNull();
      mixed.unmount();
    });

    it('narrows to a type: a range over a button alone is the selected button, not an image', () => {
      // <div>(0) C l i c k ␣ → the button sits at 7, " here" from 8.
      const { editor, range, unmount } = mount(`<div>Click ${BUTTON} here</div>`);
      range(6, 9);
      expect(selectedButton(editor.state)?.pos).toBe(7);
      expect(selectedImage(editor.state)).toBeNull();
      range(5, 9);
      expect(selectedButton(editor.state)).toBeNull();
      unmount();
    });
  });

  describe('the bubble menu: the atom’s own for the atom alone, the text’s otherwise', () => {
    const open = (content: string) => {
      vi.useFakeTimers();
      const states: BubbleMenuState[] = [];
      const mounted = mount(content, [
        createBubbleMenu({ updateDelay: 0, onStateChange: (state) => states.push(state) }),
      ]);
      mounted.editor.view.hasFocus = () => true;
      const kind = () => {
        vi.runAllTimers();
        const last = states[states.length - 1];
        return last.isOpen ? last.kind : 'closed';
      };
      return { ...mounted, kind, unmount: () => (vi.useRealTimers(), mounted.unmount()) };
    };

    it('a dragged-over button with its spaces is the button menu; with a letter, the text menu', () => {
      const { range, kind, unmount } = open(`<div>Click ${BUTTON} here</div>`);
      range(6, 9);
      expect(kind()).toBe('button');
      range(5, 9);
      expect(kind()).toBe('text');
      unmount();
    });

    it('an image and a button together are text', () => {
      const { range, node, kind, unmount } = open(`<div><img src="a.png"> ${BUTTON}</div>`);
      node(1);
      expect(kind()).toBe('image');
      range(1, 4);
      expect(kind()).toBe('text');
      unmount();
    });

    it('opens after the delay, but once open follows the selection at once', () => {
      vi.useFakeTimers();
      const states: BubbleMenuState[] = [];
      const { editor, range, unmount } = mount(IMAGE_LINE, [
        createBubbleMenu({ updateDelay: 150, onStateChange: (state) => states.push(state) }),
      ]);
      editor.view.hasFocus = () => true;
      const last = () => states[states.length - 1];

      // Opening waits: a range passing through pops nothing.
      range(1, 3);
      expect(states).toHaveLength(0);
      vi.advanceTimersByTime(150);
      expect(last()).toMatchObject({ isOpen: true, kind: 'text' });

      // Open, the next step is heard in the same transaction: the image
      // alone is the image's menu now — not the text's for 150ms more,
      // showing an alt that is no longer the selection's.
      const heard = states.length;
      range(imagePos, imagePos + 1);
      expect(states.length).toBe(heard + 1);
      expect(last()).toMatchObject({ isOpen: true, kind: 'image' });
      range(imagePos, imagePos + 3);
      expect(last()).toMatchObject({ isOpen: true, kind: 'text' });

      // Closed, the next opening waits again.
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
      expect(last()).toMatchObject({ isOpen: false });
      const closed = states.length;
      range(1, 3);
      expect(states.length).toBe(closed);
      vi.advanceTimersByTime(150);
      expect(last()).toMatchObject({ isOpen: true, kind: 'text' });
      vi.useRealTimers();
      unmount();
    });
  });

  describe('text styling on a range with a button in it lands on the label too', () => {
    const LINE = `<div>Click ${BUTTON} here</div>`;
    const button = (view: EditorView) => view.state.doc.nodeAt(7)!;

    it('bold is on where the button is bold; toggling takes it off the button with the text, and back on', () => {
      const { editor, range, unmount } = mount(LINE);
      const bold = editor.schema.marks['bold'];
      range(1, 13);
      expect(isMarkActive(editor.state, bold)).toBe(true);
      expect(editor.commands['toggleBold']()).toBe(true);
      expect(button(editor.view).attrs['bold']).toBe(false);
      expect(isMarkActive(editor.state, bold)).toBe(false);
      expect(editor.commands['toggleBold']()).toBe(true);
      expect(button(editor.view).attrs['bold']).toBe(true);
      expect(editor.getHTML()).toContain('<strong style="font-weight: bold;">Click </strong><a');
      // The button paints itself: never a mark around it.
      expect(editor.getHTML()).not.toContain('<strong style="font-weight: bold;"><a');
      unmount();
    });

    it('italic: on the text as a mark, on the button as its attribute', () => {
      const { editor, range, unmount } = mount(LINE);
      range(1, 13);
      expect(editor.commands['toggleItalic']()).toBe(true);
      expect(button(editor.view).attrs['italic']).toBe(true);
      expect(editor.getHTML()).toContain('<em style="font-style: italic;">Click </em><a');
      expect(editor.getHTML()).toContain('font-style: italic;');
      unmount();
    });

    it('a range over the button alone flips it and stays a range', () => {
      const { editor, range, unmount } = mount(LINE);
      range(6, 9);
      expect(editor.commands['toggleBold']()).toBe(true);
      expect(button(editor.view).attrs['bold']).toBe(false);
      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect([editor.state.selection.from, editor.state.selection.to]).toEqual([6, 9]);
      unmount();
    });

    it('an image in the range takes no mark', () => {
      const { editor, range, unmount } = mount(IMAGE_LINE);
      range(1, 14);
      editor.commands['toggleBold']();
      expect(editor.state.doc.nodeAt(imagePos)?.marks).toHaveLength(0);
      expect(editor.getHTML()).toBe(
        '<div><strong style="font-weight: bold;">hello </strong><img src="x.png" alt="dot" style="max-width: 100%; height: auto;"><strong style="font-weight: bold;"> world</strong></div>',
      );
      unmount();
    });
  });

  describe('a pasted button is as bare as a loaded one', () => {
    it('strips the bold the parser paints around it', () => {
      const { editor, unmount } = mount('<div>x</div>');
      const dom = document.createElement('div');
      dom.innerHTML = `<div>Click ${BUTTON} here</div>`;
      const parsed = DOMParser.fromSchema(editor.schema).parseSlice(dom);
      const find = (slice: typeof parsed) => {
        let found: { marks: number } | null = null;
        slice.content.descendants((node) => {
          if (node.type.name === 'button') found = { marks: node.marks.length };
          return !found;
        });
        return found as { marks: number } | null;
      };
      expect(find(parsed)).toEqual({ marks: 1 });
      const transformed = editor.view.someProp('transformPasted', (f) =>
        f(parsed, editor.view, false),
      );
      expect(find(transformed!)).toEqual({ marks: 0 });
      unmount();
    });
  });

  describe('Shift-arrow from a selected atom grows a range that keeps it', () => {
    const press = (view: EditorView, key: string) =>
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true }),
      );

    it('right takes the next character, left the previous — the atom stays in', () => {
      const { editor, node, unmount } = mount(IMAGE_LINE);
      node(imagePos);
      press(editor.view, 'ArrowRight');
      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([7, 9]);
      // The character it took is a space: still the image alone.
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      node(imagePos);
      press(editor.view, 'ArrowLeft');
      expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([8, 6]);
      unmount();
    });

    it('at the line’s end, right reaches into the next line', () => {
      // <div>(0) h i ␣ → image at 4, the line closes at 5; "next" starts at 7.
      const { editor, node, unmount } = mount('<div>hi <img src="x.png"></div><div>next</div>');
      node(4);
      press(editor.view, 'ArrowRight');
      expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([4, 7]);
      unmount();
    });

    it('a selected atom beside another takes it whole', () => {
      const { editor, node, unmount } = mount('<div><img src="a.png"><img src="b.png"></div>');
      node(1);
      press(editor.view, 'ArrowRight');
      expect([editor.state.selection.anchor, editor.state.selection.head]).toEqual([1, 3]);
      unmount();
    });
  });

  describe('a press on an atom, or on its line, is the plugin’s whole: the click, or the drag', () => {
    // A press: ProseMirror's own handling runs first (posAtCoords answers
    // for the point), then the plugin's — which keeps the browser out of
    // a press it owns (defaultPrevented). Each press lands somewhere new,
    // or ProseMirror would read presses in a row as a double, then a
    // triple click.
    let origin = 0;
    const press = (
      view: EditorView,
      target: Element,
      at: { pos: number; inside: number },
      init: MouseEventInit = {},
    ) => {
      origin += 100;
      view.posAtCoords = () => at;
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: origin,
        clientY: 0,
        ...init,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // The pointer, moved `by` pixels from the press — past the click's
    // slack unless said otherwise — over a point.
    const move = (view: EditorView, at: { pos: number; inside: number }, by = 30) => {
      view.posAtCoords = () => at;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: origin + by, clientY: 0 }));
    };
    const release = (view: EditorView, by = 30) =>
      view.dom.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: origin + by, clientY: 0 }),
      );
    const sel = (view: EditorView) => [view.state.selection.anchor, view.state.selection.head];
    const image = (view: EditorView) => view.nodeDOM(imagePos) as HTMLElement;
    const line = (view: EditorView) => image(view).parentElement!;
    const AT_IMAGE = { pos: imagePos, inside: imagePos };
    const inText = (pos: number) => ({ pos, inside: 0 });

    it('on the image: released in place it is the click, moved it is the drag from the image', () => {
      const { editor, unmount } = mount(IMAGE_LINE);
      const { view } = editor;
      const img = image(view).querySelector('img')!;
      expect(press(view, img, AT_IMAGE)).toBe(true);
      expect(view.state.selection.empty).toBe(true);
      release(view, 0);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      expect(selectedImage(view.state)?.pos).toBe(imagePos);
      // Pressed again while selected: ProseMirror's (a drag would move it).
      expect(press(view, img, AT_IMAGE)).toBe(false);
      release(view, 0);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      // Unselected, pressed and moved: the drag — a hand's tremor within
      // the click's slack is no drag yet.
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
      expect(press(view, img, AT_IMAGE)).toBe(true);
      move(view, inText(11), 2);
      expect(sel(view)).toEqual([2, 2]);
      move(view, inText(11));
      expect(sel(view)).toEqual([7, 11]);
      // Back before it: anchored after the image.
      move(view, inText(3));
      expect(sel(view)).toEqual([8, 3]);
      // Over itself: the image alone.
      move(view, AT_IMAGE);
      expect(sel(view)).toEqual([7, 8]);
      expect(selectedImage(view.state)?.pos).toBe(imagePos);
      release(view);
      expect(sel(view)).toEqual([7, 8]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      unmount();
    });

    it('on the image’s line: the drag from the press covers the image whichever half the pointer is over', () => {
      const { editor, unmount } = mount(IMAGE_LINE);
      const { view } = editor;
      expect(press(view, line(view), inText(3))).toBe(true);
      move(view, AT_IMAGE);
      expect(sel(view)).toEqual([3, 8]);
      // On into the text after it, and past the line: the plugin's still.
      move(view, inText(11));
      expect(sel(view)).toEqual([3, 11]);
      release(view);
      // From after it, back onto it.
      expect(press(view, line(view), inText(11))).toBe(true);
      move(view, AT_IMAGE);
      expect(sel(view)).toEqual([11, 7]);
      release(view);
      // From right beside it: the image alone.
      expect(press(view, line(view), inText(8))).toBe(true);
      move(view, AT_IMAGE);
      expect(sel(view)).toEqual([8, 7]);
      expect(selectedImage(view.state)?.pos).toBe(imagePos);
      release(view);
      unmount();
    });

    it('on the image’s line, released in place: the caret, at the press', () => {
      const { editor, unmount } = mount(IMAGE_LINE);
      const { view } = editor;
      expect(press(view, line(view), inText(3))).toBe(true);
      release(view, 0);
      expect(sel(view)).toEqual([3, 3]);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      unmount();
    });

    it('over another atom the range takes that one whole', () => {
      const { editor, unmount } = mount('<div><img src="a.png"> <img src="b.png"> x</div>');
      const { view } = editor;
      press(view, view.nodeDOM(1) as HTMLElement, { pos: 1, inside: 1 });
      move(view, { pos: 3, inside: 3 });
      expect(sel(view)).toEqual([1, 4]);
      release(view);
      // And from the second, back over the first.
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
      press(view, view.nodeDOM(3) as HTMLElement, { pos: 3, inside: 3 });
      move(view, { pos: 1, inside: 1 });
      expect(sel(view)).toEqual([4, 1]);
      release(view);
      unmount();
    });

    it('a click on a button goes through ProseMirror’s click handlers: its link editor is asked to open', () => {
      const edits: number[] = [];
      const { editor, unmount } = mount(`<div>Click ${BUTTON} here</div>`, [
        createButtonEdit({ onEdit: (target) => edits.push(target.pos) }),
      ]);
      const { view } = editor;
      expect(press(view, view.nodeDOM(7) as HTMLElement, { pos: 7, inside: 7 })).toBe(true);
      release(view, 0);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      expect(selectedButton(view.state)?.pos).toBe(7);
      expect(edits).toEqual([7]);
      unmount();
    });

    it('a shift-click is the browser’s alone', () => {
      const { editor, unmount } = mount(IMAGE_LINE);
      const { view } = editor;
      expect(press(view, line(view), inText(3), { shiftKey: true })).toBe(false);
      move(view, AT_IMAGE);
      expect(sel(view)).toEqual([1, 1]);
      release(view);
      unmount();
    });

    it('a drag of an unselected atom the press never saw is cancelled, and the atom is the selection', () => {
      const { editor, unmount } = mount(IMAGE_LINE);
      const { view } = editor;
      const event = { target: image(view), preventDefault: vi.fn() } as unknown as DragEvent;
      expect(view.someProp('handleDOMEvents', (h) => h['dragstart']?.(view, event))).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(sel(view)).toEqual([7, 8]);
      // A selected atom still drags — the move is ProseMirror's.
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imagePos)));
      const again = { target: image(view), preventDefault: vi.fn() } as unknown as DragEvent;
      expect(view.someProp('handleDOMEvents', (h) => h['dragstart']?.(view, again))).toBeFalsy();
      expect(again.preventDefault).not.toHaveBeenCalled();
      unmount();
    });
  });

  describe('a press on another line is the browser’s drag, corrected over an atom', () => {
    // <div>hello <img> world</div>(15) <div>(15) next → "next" from 16.
    const TWO_LINES = '<div>hello <img src="x.png" alt="dot"> world</div><div>next</div>';
    const press = (view: EditorView, pos: number) => {
      view.posAtCoords = () => ({ pos, inside: 15 });
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 0,
        clientY: 0,
      });
      view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const move = (view: EditorView, at: { pos: number; inside: number }) => {
      view.posAtCoords = () => at;
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 0 }));
    };
    const release = (view: EditorView) =>
      view.dom.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 30, clientY: 0 }),
      );
    const sel = (view: EditorView) => [view.state.selection.anchor, view.state.selection.head];
    /** What ProseMirror would make of a browser selection between the two. */
    const read = (view: EditorView, anchor: number, head: number) => {
      const { doc } = view.state;
      const found = view.someProp('createSelectionBetween', (f) =>
        f(view, doc.resolve(anchor), doc.resolve(head)),
      );
      return found ? [found.anchor, found.head] : null;
    };

    it('covers the atom while the pointer is over it, on each move and on every read; the text is the browser’s', () => {
      vi.useFakeTimers();
      const { editor, unmount } = mount(TWO_LINES);
      const { view } = editor;
      expect(press(view, 17)).toBe(false);
      move(view, { pos: imagePos, inside: imagePos });
      expect(sel(view)).toEqual([17, 7]);
      // What the browser gives meanwhile — short of the image — is read
      // the same way, so the two never disagree.
      expect(read(view, 17, 8)).toEqual([17, 7]);
      // Over the text: nothing is made here, and a read is the browser's.
      move(view, { pos: 3, inside: 0 });
      expect(sel(view)).toEqual([17, 7]);
      expect(read(view, 17, 3)).toBeNull();
      // Released over the image: the browser's last word, a moment after
      // the release, is still read against the drag — then it is gone.
      move(view, { pos: imagePos, inside: imagePos });
      release(view);
      expect(read(view, 17, 8)).toEqual([17, 7]);
      vi.advanceTimersByTime(100);
      expect(read(view, 17, 8)).toBeNull();
      vi.useRealTimers();
      unmount();
    });
  });

  describe('an image fitted to its line leaves the caret its room', () => {
    it('caps a known width under the ceiling and leaves an unknown one fluid', () => {
      expect(fitImageWidth(600, 564)).toBe(564);
      expect(fitImageWidth(300, 564)).toBe(300);
      expect(fitImageWidth(null, 564)).toBeNull();
      expect(fitImageWidth(600, null)).toBe(600);
    });
  });
});
