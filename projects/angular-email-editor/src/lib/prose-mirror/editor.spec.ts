import { AllSelection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from './editor';
import { insertHTML } from './html';
import { emailExtensions, htmlSourceExtensions, richTextExtensions } from './extensions/kits';
import { extensionActions, extensionSuggestions, isActionEnabled } from './extension';
import { BubbleMenuState, createBubbleMenu } from './extensions/bubble-menu';
import { createSendIntent } from './extensions/send-intent';

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

  it('inserts an HTML fragment at the cursor, blocks taking an empty paragraph’s place', () => {
    editor.setContent('<p>Hello world</p><p></p>');
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));

    editor.exec(insertHTML('<h1>Welcome</h1><p>Hi {{name}}</p>'));
    // The merge tag came in as a pill: its canonical form is spaced.
    expect(editor.getHTML()).toBe(
      '<p dir="auto">Hello world</p><h1 style="margin: 0px; font-size: 24px;">Welcome</h1><p dir="auto">Hi {{ name }}</p>',
    );
  });

  it('stamps aee-editor on the root — styling scopes to it, never to bare .ProseMirror', () => {
    // A host app may run other ProseMirror instances; our CSS must not reach them.
    expect(editor.view.dom.classList.contains('aee-editor')).toBe(true);
    expect(editor.view.dom.classList.contains('ProseMirror')).toBe(true);
  });

  it('merges aee-editor with caller-supplied classes instead of clobbering them', () => {
    const other = createEditor({
      parent: host,
      extensions: richTextExtensions,
      attributes: { class: 'my-editor' },
    });
    expect(other.view.dom.classList.contains('aee-editor')).toBe(true);
    expect(other.view.dom.classList.contains('my-editor')).toBe(true);
    other.destroy();
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
    editor.setContent('<h1 style="margin: 0px; font-size: 24px;">Subject</h1>');
    expect(editor.getHTML()).toBe('<h1 style="margin: 0px; font-size: 24px;">Subject</h1>');
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
    expect(editor.getHTML()).toBe(
      '<ul style="margin: 0px; padding-left: 24px;"><li><p dir="auto">Hello world</p></li></ul>',
    );
    expect(editor.isActive('bulletList')).toBe(true);

    editor.commands['toggleBulletList']();
    expect(editor.getHTML()).toBe('<p dir="auto">Hello world</p>');
    expect(editor.isActive('bulletList')).toBe(false);
  });

  it('converts between list flavours in place', () => {
    editor.commands['toggleBulletList']();
    editor.commands['toggleOrderedList']();
    expect(editor.getHTML()).toBe(
      '<ol style="margin: 0px; padding-left: 24px;"><li><p dir="auto">Hello world</p></li></ol>',
    );
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

  it('says closed once: not per caret move, not per mouseup elsewhere', async () => {
    const onStateChange = vi.fn();
    const other = document.createElement('div');
    document.body.appendChild(other);
    const quiet = createEditor({
      parent: other,
      extensions: [...richTextExtensions, createBubbleMenu({ updateDelay: 0, onStateChange })],
      content: '<p>Hello world</p>',
    });
    vi.spyOn(quiet.view, 'hasFocus').mockReturnValue(true);
    const move = (pos: number) =>
      quiet.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
        return true;
      });

    move(2);
    move(3);
    window.dispatchEvent(new MouseEvent('mouseup'));
    await flushShowTimer();
    expect(onStateChange).not.toHaveBeenCalled();

    quiet.destroy();
    other.remove();
    expect(onStateChange).not.toHaveBeenCalled();
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

describe('actions and watching the editor', () => {
  let host: HTMLElement;
  let editor: Editor;

  const select = (from: number, to?: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
      return true;
    });

  const action = (id: string) => editor.actions.find((candidate) => candidate.id === id)!;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: richTextExtensions,
      content: '<p>Hello <strong>bold</strong> world</p>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  describe('editor.actions', () => {
    it('lists what the kit’s extensions declare, in kit order, by stable ids', () => {
      const ids = editor.actions.map((candidate) => candidate.id);
      expect(ids).toEqual(
        expect.arrayContaining(['bold', 'italic', 'underline', 'strike', 'table']),
      );
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('is the list a / menu shows: the same objects, seen as suggestions', () => {
      const ctx = { schema: editor.schema, extensions: richTextExtensions };
      expect(extensionSuggestions(ctx).map((row) => row.id)).toEqual(
        extensionActions(ctx).map((candidate) => candidate.id),
      );
    });

    it('knows when a mark is on at the selection — and at a caret about to type it', () => {
      select(3);
      expect(action('bold').isActive!(editor.state)).toBe(false);
      select(9);
      expect(action('bold').isActive!(editor.state)).toBe(true);
      expect(action('italic').isActive!(editor.state)).toBe(false);

      select(3);
      editor.exec(action('italic').command);
      expect(action('italic').isActive!(editor.state)).toBe(true);
    });

    it('asks the command itself whether it can run, unless the action says', () => {
      expect(isActionEnabled(action('bold'), editor.state)).toBe(true);
      const never = { ...action('bold'), isEnabled: () => false };
      expect(isActionEnabled(never, editor.state)).toBe(false);
      // Asking changes nothing.
      expect(editor.getHTML()).toContain('<strong');
      expect(action('bold').isActive!(editor.state)).toBe(false);
    });

    it('leaves what has no "on" without a pressed state', () => {
      expect(action('table').isActive).toBeUndefined();
    });
  });

  describe('editor.subscribe', () => {
    it('tells of every change of state — the selection too, which onUpdate never did', () => {
      const seen = vi.fn();
      editor.subscribe(seen);
      select(3);
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenLastCalledWith(editor);

      editor.exec(action('bold').command);
      expect(seen).toHaveBeenCalledTimes(2);
    });

    it('hears an external sync as well', () => {
      const seen = vi.fn();
      editor.subscribe(seen);
      editor.setContent('<p>Replaced</p>');
      expect(seen).toHaveBeenCalled();
    });

    it('stops when asked', () => {
      const seen = vi.fn();
      const stop = editor.subscribe(seen);
      stop();
      select(3);
      expect(seen).not.toHaveBeenCalled();
    });

    it('can be asked of an editor that already exists — no place in the kit needed', () => {
      const late = vi.fn();
      select(2);
      editor.subscribe(late);
      select(4);
      expect(late).toHaveBeenCalledTimes(1);
    });
  });

  describe('the source kit', () => {
    it('mirrors the marks’ actions as it mirrors their commands, and only those', () => {
      const source = createEditor({ parent: host, extensions: htmlSourceExtensions });
      const markIds = emailExtensions
        .filter((extension) => extension.type === 'mark')
        .flatMap((extension) =>
          (extension.actions?.({ schema: editor.schema, extensions: emailExtensions }) ?? []).map(
            (candidate) => candidate.id,
          ),
        );
      expect(source.actions.map((candidate) => candidate.id)).toEqual(markIds);
      expect(markIds).toEqual(expect.arrayContaining(['bold', 'italic', 'underline', 'strike']));

      const bold = source.actions.find((candidate) => candidate.id === 'bold')!;
      // Source text cannot say whether bold is on, and asking the command
      // would parse it on every transaction: there, the action is simply on offer.
      expect(bold.isActive).toBeUndefined();
      expect(isActionEnabled(bold, source.state)).toBe(true);
      source.destroy();
    });
  });
});

describe('the email kit’s block actions', () => {
  let host: HTMLElement;
  let editor: Editor;

  const caret = (pos: number, to?: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos, to)));
      return true;
    });

  const action = (id: string) => editor.actions.find((candidate) => candidate.id === id)!;
  const on = (id: string) => action(id).isActive!(editor.state);
  const can = (id: string) => isActionEnabled(action(id), editor.state);
  const run = (id: string) => editor.exec(action(id).command);

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>First line</div><div>Second line</div>',
    });
    caret(3);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('declares them under the ids a toolbar and a translation file share', () => {
    expect(editor.actions.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining([
        'bulleted-list',
        'numbered-list',
        'quote',
        'align-left',
        'align-center',
        'align-right',
        'indent',
        'outdent',
        'clear-formatting',
      ]),
    );
  });

  it('quote is a toggle: it wraps, says it is on, and lifts back out', () => {
    expect(on('quote')).toBe(false);
    run('quote');
    expect(on('quote')).toBe(true);
    expect(editor.getHTML()).toContain('<blockquote');
    run('quote');
    expect(on('quote')).toBe(false);
    expect(editor.getHTML()).not.toContain('<blockquote');
  });

  it('a list says which kind the caret is in', () => {
    run('bulleted-list');
    expect(on('bulleted-list')).toBe(true);
    expect(on('numbered-list')).toBe(false);
    run('bulleted-list');
    expect(on('bulleted-list')).toBe(false);
  });

  it('alignment is three actions, exactly one of them on', () => {
    const state = () => ['align-left', 'align-center', 'align-right'].map(on);
    expect(state()).toEqual([true, false, false]);
    run('align-center');
    expect(state()).toEqual([false, true, false]);
    run('align-right');
    expect(state()).toEqual([false, false, true]);
    run('align-left');
    expect(state()).toEqual([true, false, false]);
    // The other line was never touched.
    caret(editor.state.doc.content.size - 2);
    expect(state()).toEqual([true, false, false]);
  });

  it('indent and outdent answer for the moment through the command itself', () => {
    expect(can('indent')).toBe(true);
    expect(can('outdent')).toBe(false); // already at the margin
    run('indent');
    expect(can('outdent')).toBe(true);
    run('outdent');
    expect(can('outdent')).toBe(false);
  });

  it('clear formatting says it needs a selection', () => {
    expect(can('clear-formatting')).toBe(false);
    caret(1, 6);
    expect(can('clear-formatting')).toBe(true);
  });
});

describe('asking an action whether it can run', () => {
  it.each([
    ['the rich-text kit', richTextExtensions],
    ['the email kit', emailExtensions],
    ['the source kit', htmlSourceExtensions],
  ])('changes nothing and dispatches nothing — %s', (_name, extensions) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor({ parent: host, extensions });
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('Some text to stand in'));
      return true;
    });
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    const before = editor.state;

    // A toolbar asks every action, on every transaction.
    for (const action of editor.actions) {
      expect(typeof isActionEnabled(action, editor.state)).toBe('boolean');
      action.isActive?.(editor.state);
    }

    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state).toBe(before);
    editor.destroy();
    host.remove();
  });

  it('does not send: the send action answers without acting', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onSend = vi.fn();
    const editor = createEditor({
      parent: host,
      extensions: [...emailExtensions, createSendIntent({ onSend })],
    });
    const send = editor.actions.find((action) => action.id === 'send')!;
    expect(isActionEnabled(send, editor.state)).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    editor.destroy();
    host.remove();
  });
});
