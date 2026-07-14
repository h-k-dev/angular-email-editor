import { AllSelection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from './editor';
import { richTextExtensions } from './extensions/kits';
import { BubbleMenuState, createBubbleMenu } from './extensions/bubble-menu';

describe('createEditor', () => {
  let host: HTMLElement;
  let editor: Editor;
  let updates: string[];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    updates = [];
    editor = createEditor({
      parent: host,
      extensions: richTextExtensions,
      content: '<p>Hello world</p>',
      attributes: { role: 'textbox' },
      onUpdate: (e) => updates.push(e.getHTML()),
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('mounts an editable view with the initial content', () => {
    expect(host.querySelector('[role="textbox"]')).toBeTruthy();
    expect(editor.getHTML()).toBe('<p dir="auto">Hello world</p>');
  });

  it('exposes extension commands bound to the view', () => {
    // Select the whole document, then toggle bold via the named command.
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
      return true;
    });
    expect(editor.commands['toggleBold']()).toBe(true);
    expect(editor.getHTML()).toBe(
      '<p dir="auto"><strong style="font-weight: bold;">Hello world</strong></p>',
    );
    expect(editor.isActive('bold')).toBe(true);
    expect(updates.at(-1)).toBe(
      '<p dir="auto"><strong style="font-weight: bold;">Hello world</strong></p>',
    );
  });

  it('setContent replaces the document', () => {
    editor.setContent('<h1>Subject</h1>');
    expect(editor.getHTML()).toBe('<h1>Subject</h1>');
  });

  it('setContent never fires onUpdate — mirrored editors cannot echo', () => {
    editor.setContent('<p>External</p>');
    expect(updates).toEqual([]);
  });

  it('setContent preserves the local undo history across external syncs', () => {
    // A local edit (enters history) ...
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
      return true;
    });
    editor.commands['toggleBold']();

    // ... then an external sync appends a paragraph (diff at the end only).
    editor.setContent(editor.getHTML() + '<p>Appended</p>');

    // Undo reverts the local bold; the externally synced content stays.
    expect(editor.commands['undo']()).toBe(true);
    expect(editor.getHTML()).toBe('<p dir="auto">Hello world</p><p dir="auto">Appended</p>');
  });

  it('setContent maps the selection through the diff', () => {
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      return true;
    });

    // Prepending a paragraph shifts the diff before the selection ...
    editor.setContent('<p dir="auto">Intro</p><p dir="auto">Hello world</p>');
    expect(
      editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to),
    ).toBe('Hello');

    // ... while a diff after the selection leaves it untouched.
    const { from, to } = editor.state.selection;
    editor.setContent('<p dir="auto">Intro</p><p dir="auto">Hello world</p><p dir="auto">Tail</p>');
    expect(editor.state.selection.from).toBe(from);
    expect(editor.state.selection.to).toBe(to);
  });

  it('reports wrapping nodes active from anywhere inside them', () => {
    expect(editor.isActive('blockquote')).toBe(false);
    editor.commands['wrapInBlockquote']();
    // The cursor's direct parent is still the paragraph.
    expect(editor.isActive('blockquote')).toBe(true);
    expect(editor.isActive('paragraph')).toBe(true);
  });

  it('toggles a bullet list on and off', () => {
    editor.commands['toggleBulletList']();
    expect(editor.getHTML()).toBe('<ul><li><p dir="auto">Hello world</p></li></ul>');
    expect(editor.isActive('bulletList')).toBe(true);

    editor.commands['toggleBulletList']();
    expect(editor.getHTML()).toBe('<p dir="auto">Hello world</p>');
    expect(editor.isActive('bulletList')).toBe(false);
  });

  it('converts between list flavours in place', () => {
    editor.commands['toggleBulletList']();
    editor.commands['toggleOrderedList']();
    expect(editor.getHTML()).toBe('<ol><li><p dir="auto">Hello world</p></li></ol>');
    expect(editor.isActive('orderedList')).toBe(true);
    expect(editor.isActive('bulletList')).toBe(false);
  });

  it('prevents dragging selected text but not draggable nodes', () => {
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      return true;
    });
    const dragstart = new Event('dragstart', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(dragstart);
    expect(dragstart.defaultPrevented).toBe(true);
  });
});

describe('createBubbleMenu', () => {
  let host: HTMLElement;
  let editor: Editor;
  let hasFocus: any;
  let menuState: BubbleMenuState;

  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  // Opening is debounced through a timer (updateDelay: 0 → next macrotask);
  // closing is synchronous.
  const flushShowTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const select = (from: number, to?: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
      return true;
    });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    menuState = { isOpen: false, boundingBox: null };

    editor = createEditor({
      parent: host,
      // updateDelay: 0 keeps the debounce to a single macrotask; the debounce
      // itself is covered by the fake-timer test below.
      extensions: [
        ...richTextExtensions,
        createBubbleMenu({ updateDelay: 0, onStateChange: (state) => (menuState = state) }),
      ],
      content: '<p>Hello world</p>',
    });
    // jsdom has no layout; coords only feed the virtual anchor rect, not visibility.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    // jsdom can't focus contenteditable, and the menu only shows for a focused editor.
    hasFocus = vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
    // jsdom lacks elementFromPoint, which ProseMirror's own mousedown handler hits.
    document.elementFromPoint ??= () => null;
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('opens on a text selection and closes when it collapses', async () => {
    expect(menuState.isOpen).toBe(false);

    select(1, 6);
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);
    expect(menuState.boundingBox).not.toBeNull();

    select(1);
    expect(menuState.isOpen).toBe(false);
    expect(menuState.boundingBox).toBeNull();
  });

  it('waits for mouseup while the mouse is laying out a selection', async () => {
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    select(1, 6); // selection grows during the drag
    await flushShowTimer();
    expect(menuState.isOpen).toBe(false);

    window.dispatchEvent(new MouseEvent('mouseup'));
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);
  });

  it('ignores mousedown outside the editor text (e.g. the overlayed menu)', async () => {
    // A mousedown outside view.dom — above all on the bubble menu itself,
    // which renders in a CDK overlay — must not count as a selection drag.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    select(1, 6);
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);
  });

  it('exposes a virtual anchor rect on select-all', async () => {
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
      return true;
    });
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);
    // Coords are mocked to zeros, so the virtual rect collapses to the origin.
    expect(menuState.boundingBox).toMatchObject({ top: 0, left: 0, width: 0, height: 0 });
  });

  it('stays closed while the editor is blurred, without flashing back', async () => {
    select(1, 6);
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);

    // Click outside: the editor blurs but ProseMirror keeps its selection.
    // Blur handling is deferred a frame to let focus settle first.
    hasFocus.mockReturnValue(false);
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    await nextFrame();
    expect(menuState.isOpen).toBe(false);

    // Later state updates with the lingering selection must not re-open it.
    select(1, 8);
    await flushShowTimer();
    expect(menuState.isOpen).toBe(false);

    hasFocus.mockReturnValue(true);
    editor.view.dom.dispatchEvent(new FocusEvent('focus'));
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);
  });

  it('rides out a transient blur when focus returns within the frame', async () => {
    select(1, 6);
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);

    // hasFocus still reports true by the time the deferred check runs —
    // the end-of-line drag case where the browser blurs and refocuses.
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    await nextFrame();
    await flushShowTimer();
    expect(menuState.isOpen).toBe(true);
  });

  it('debounces opening through selection bursts (default updateDelay)', () => {
    vi.useFakeTimers();
    try {
      let burstState: BubbleMenuState = { isOpen: false, boundingBox: null };
      const burstEditor = createEditor({
        parent: host,
        extensions: [
          ...richTextExtensions,
          createBubbleMenu({ onStateChange: (state) => (burstState = state) }),
        ],
        content: '<p>Hello world</p>',
      });
      vi.spyOn(burstEditor.view, 'coordsAtPos').mockReturnValue({
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      });
      vi.spyOn(burstEditor.view, 'hasFocus').mockReturnValue(true);

      const burstSelect = (from: number, to: number) =>
        burstEditor.exec((state, dispatch) => {
          dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
          return true;
        });

      // A burst of selection adjustments (as browsers emit around line ends)
      // keeps pushing the timer back — the menu never opens in between.
      burstSelect(1, 4);
      vi.advanceTimersByTime(100);
      expect(burstState.isOpen).toBe(false);
      burstSelect(1, 6);
      vi.advanceTimersByTime(100);
      expect(burstState.isOpen).toBe(false);

      // Once the selection is stable for the full delay it opens exactly once.
      vi.advanceTimersByTime(50);
      expect(burstState.isOpen).toBe(true);

      burstEditor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
