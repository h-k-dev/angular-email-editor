import { createEditor, Editor } from '../editor';
import { richTextExtensions } from './kits';
import { SlashMenuState, createSlashMenu } from './slash-menu';

describe('createSlashMenu', () => {
  let host: HTMLElement;
  let menu: HTMLElement;
  let editor: Editor;
  let state: SlashMenuState | undefined;

  const type = (text: string) =>
    editor.exec((editorState, dispatch) => {
      dispatch?.(editorState.tr.insertText(text));
      return true;
    });

  const keydown = (key: string) =>
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(() => {
    host = document.createElement('div');
    menu = document.createElement('div');
    host.appendChild(menu);
    document.body.appendChild(host);
    state = undefined;

    editor = createEditor({
      parent: host,
      extensions: [
        ...richTextExtensions,
        createSlashMenu({ element: menu, onChange: (s) => (state = s) }),
      ],
    });
    // jsdom has no layout; coords only feed positioning, not open/close logic.
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    // jsdom lacks elementFromPoint, which ProseMirror's own mousedown handler hits.
    document.elementFromPoint ??= () => null;
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('opens with the kit-declared commands when / is typed', () => {
    type('/');
    expect(state?.open).toBe(true);
    expect(state?.items.map((item) => item.title)).toEqual([
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Quote',
      'Bulleted list',
      'Numbered list',
      'Image',
      'Divider',
      'Button',
      'Table',
      'Bold',
      'Italic',
      'Underline',
      'Strike',
    ]);
    expect(menu.style.visibility).toBe('visible');
  });

  it('only triggers at a block start or after whitespace', () => {
    type('a/');
    expect(state?.open ?? false).toBe(false);

    type(' /');
    expect(state?.open).toBe(true);
  });

  it('filters by title and keywords as the query grows', () => {
    type('/head');
    expect(state?.items.map((item) => item.title)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);

    type('ing 2');
    expect(state?.items.map((item) => item.title)).toEqual(['Heading 2']);

    type('zzz');
    expect(state?.open).toBe(false);
    expect(menu.style.visibility).toBe('hidden');
  });

  it('navigates with arrows and applies with Enter, removing the query text', () => {
    type('/head');
    keydown('ArrowDown');
    expect(state?.activeIndex).toBe(1);

    keydown('Enter');
    expect(editor.getHTML()).toBe('<h2></h2>');
    expect(state?.open).toBe(false);
  });

  it('wraps the arrow navigation around the list', () => {
    type('/head');
    keydown('ArrowUp');
    expect(state?.activeIndex).toBe(2);
  });

  it('applies items through select() for pointer use', () => {
    type('/qu');
    expect(state?.items.map((item) => item.title)).toEqual(['Quote']);

    state!.select(state!.items[0]);
    expect(editor.getHTML()).toBe('<blockquote><p dir="auto"></p></blockquote>');
    expect(state?.open).toBe(false);
  });

  it('closes on the first mousedown outside, regardless of focus', () => {
    type('/');
    expect(state?.open).toBe(true);

    // e.g. a toolbar button that preventDefaults its mousedown — no blur fires.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(false);
    expect(menu.style.visibility).toBe('hidden');
  });

  it('stays open when the mousedown is on the menu itself', () => {
    type('/');
    menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(true);
  });

  it('closes when clicking blank space inside the editable', () => {
    type('/');
    expect(state?.open).toBe(true);

    // Such clicks map to the nearest text position — often exactly where the
    // cursor already is — so no selection change will close the session.
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state?.open).toBe(false);
    expect(menu.style.visibility).toBe('hidden');
  });

  it('closes when an outside click blurs the editor', async () => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    type('/');
    expect(state?.open).toBe(true);

    // Focus moves elsewhere; the cursor (and thus the session text) is unchanged.
    editor.view.dom.dispatchEvent(new FocusEvent('blur'));
    await nextFrame();
    expect(state?.open).toBe(false);
    expect(menu.style.visibility).toBe('hidden');

    // Typing on after refocusing the same slash must not reopen it.
    type('he');
    expect(state?.open).toBe(false);
  });

  it('closes on Escape and stays closed for the same slash', () => {
    type('/');
    expect(state?.open).toBe(true);

    keydown('Escape');
    expect(state?.open).toBe(false);
    expect(menu.style.visibility).toBe('hidden');

    // Continuing to type after the same slash must not reopen it...
    type('he');
    expect(state?.open).toBe(false);

    // ...but a fresh slash elsewhere does.
    type(' /');
    expect(state?.open).toBe(true);
  });
});
